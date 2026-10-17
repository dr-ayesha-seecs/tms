import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { defaultsFor, type ProgramType } from "./form-templates";
import {
  firestoreEnvPresent,
  FirestoreStoreError,
  FirestoreVersionConflict,
  loadFirestoreSnapshot,
  readFirestoreMeta,
  saveFirestoreSnapshot,
} from "./firestore-store";
import { isReadOnlyServerlessFs } from "./runtime";

const HAS_TURSO = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
/** Firestore is used whenever Firebase credentials are present in env (takes priority over everything). */
const HAS_FIRESTORE = firestoreEnvPresent();

/**
 * Where a non-Firestore SQLite file may live.
 * Netlify and Vercel functions cannot write the deploy directory. /tmp is writable but
 * wiped between instances, so it is not the production store — Firestore is.
 */
function sqliteDir(): string {
  return isReadOnlyServerlessFs() ? os.tmpdir() : path.join(process.cwd(), "data");
}

function sqlitePath(): string {
  return path.join(sqliteDir(), "tms.sqlite");
}

export type DbMode = "firestore" | "turso" | "local-file" | "ephemeral-tmp";

/** Public, non-secret storage label (reported by /api/health). */
export type StorageLabel = "firestore" | "turso" | "local-file" | "temporary";

export class VersionConflictError extends Error {
  constructor(
    public expected: number,
    public actual: number
  ) {
    super(`DB version conflict: expected ${expected}, found ${actual}`);
    this.name = "VersionConflictError";
  }
}

export class DbPersistError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "DbPersistError";
  }
}

export function getDbMode(): DbMode {
  if (HAS_FIRESTORE) return "firestore";
  if (HAS_TURSO) return "turso";
  if (isReadOnlyServerlessFs()) return "ephemeral-tmp";
  return "local-file";
}

export function getStorageLabel(): StorageLabel {
  const m = getDbMode();
  return m === "ephemeral-tmp" ? "temporary" : m;
}

export function isDurableDb(): boolean {
  const m = getDbMode();
  return m === "firestore" || m === "turso" || m === "local-file";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Param = any;

function ensureDir() {
  const dir = sqliteDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class Stmt {
  constructor(
    private runQuery: (sql: string, params: Param[]) => { rows: Row[]; changes: number },
    private sql: string,
    private onMutate: () => Promise<void>
  ) {}

  async get(...params: Param[]): Promise<Row | undefined> {
    const { rows } = this.runQuery(this.sql, params);
    return rows[0];
  }

  async all(...params: Param[]): Promise<Row[]> {
    return this.runQuery(this.sql, params).rows;
  }

  async run(...params: Param[]): Promise<{ changes: number }> {
    const { changes } = this.runQuery(this.sql, params);
    await this.onMutate();
    return { changes };
  }
}

export class TmsDb {
  private dirty = false;
  private inTx = false;

  constructor(
    private runQuery: (sql: string, params: Param[]) => { rows: Row[]; changes: number },
    private execSql: (sql: string) => void,
    private persist: () => Promise<void>
  ) {}

  prepare(sql: string): Stmt {
    return new Stmt(this.runQuery, sql, async () => {
      this.dirty = true;
      if (!this.inTx) await this.flush();
    });
  }

  async exec(sql: string): Promise<void> {
    this.execSql(sql);
    this.dirty = true;
    if (!this.inTx) await this.flush();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTx) return fn();
    this.inTx = true;
    this.execSql("BEGIN");
    try {
      const result = await fn();
      this.execSql("COMMIT");
      this.inTx = false;
      await this.flush();
      return result;
    } catch (e) {
      try {
        this.execSql("ROLLBACK");
      } catch {
        /* ignore */
      }
      this.inTx = false;
      throw e;
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty || this.inTx) return;
    this.dirty = false;
    await this.persist();
  }
}

let dbPromise: Promise<TmsDb> | null = null;
let sqlJsDb: SqlJsDatabase | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tursoClient: any = null;

/** In-process write chain so concurrent requests on one instance serialize. */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function persistSqlJsToFirestore(db: SqlJsDatabase, expectedVersion: number): Promise<number> {
  try {
    const meta = await saveFirestoreSnapshot(db.export(), expectedVersion);
    return meta.version;
  } catch (e: unknown) {
    if (e instanceof FirestoreVersionConflict) throw new VersionConflictError(e.expected, e.actual);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[db] firestore persist failed:", msg);
    throw new DbPersistError(`Failed to persist database: ${msg}`, e);
  }
}

/** sql.js WASM module is loaded once per instance. */
let sqlModulePromise: ReturnType<typeof initSqlJs> | null = null;
function sqlWasmCandidates(): string[] {
  const roots = [process.cwd(), process.env.LAMBDA_TASK_ROOT, __dirname].filter(
    (p): p is string => Boolean(p)
  );
  const rels = [
    path.join("src", "lib", "assets", "sql-wasm.wasm"),
    path.join("node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join("assets", "sql-wasm.wasm"),
  ];
  const out: string[] = [];
  for (const root of roots) {
    for (const rel of rels) out.push(path.join(root, rel));
  }
  return out;
}

function readSqlWasm(): Buffer {
  for (const candidate of sqlWasmCandidates()) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
  }
  throw new Error(
    `sql.js WASM was not found. Checked: ${sqlWasmCandidates().join(", ")}`
  );
}

function loadSqlJs(): ReturnType<typeof initSqlJs> {
  if (!sqlModulePromise) {
    const wasmBinary = readSqlWasm();
    const wasmBuffer = wasmBinary.buffer.slice(
      wasmBinary.byteOffset,
      wasmBinary.byteOffset + wasmBinary.byteLength
    ) as ArrayBuffer;
    sqlModulePromise = initSqlJs({ wasmBinary: wasmBuffer });
    sqlModulePromise.catch(() => {
      sqlModulePromise = null;
    });
  }
  return sqlModulePromise;
}

function persistSqlJsToFile(db: SqlJsDatabase): void {
  ensureDir();
  fs.writeFileSync(sqlitePath(), Buffer.from(db.export()));
}

function rowsFromSqlJs(db: SqlJsDatabase, sql: string, params: Param[]): { rows: Row[]; changes: number } {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: Row[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Row);
    }
    const changes = db.getRowsModified();
    return { rows, changes };
  } finally {
    stmt.free();
  }
}

/**
 * @param opts.fresh  build a brand-new (seeded) database instead of loading the stored one
 *                    (used by the admin "re-seed" action; in Firestore mode it is published as the
 *                    next version through the normal version check, nothing is deleted first).
 */
async function initSqlJsDb(bootDepth = 0, opts: { fresh?: boolean } = {}): Promise<TmsDb> {
  const SQL = await loadSqlJs();

  let bytes: Uint8Array | null = null;
  const mode = getDbMode();
  let remoteVersion = 0;
  if (mode === "firestore") {
    try {
      if (opts.fresh) {
        remoteVersion = (await readFirestoreMeta())?.version ?? 0;
      } else {
        const snap = await loadFirestoreSnapshot();
        if (snap) {
          remoteVersion = snap.meta.version;
          bytes = snap.bytes;
        }
      }
    } catch (e: unknown) {
      // CRITICAL: never treat a failed read as an empty DB (that would re-seed and wipe data)
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[db] firestore load failed:", msg);
      throw new DbPersistError(
        e instanceof FirestoreStoreError ? msg : `Failed to load database from Firestore: ${msg}`,
        e
      );
    }
  } else if (opts.fresh) {
    bytes = null;
  } else if (mode === "local-file" && fs.existsSync(sqlitePath())) {
    bytes = new Uint8Array(fs.readFileSync(sqlitePath()));
  } else if (mode === "ephemeral-tmp" && fs.existsSync(sqlitePath())) {
    bytes = new Uint8Array(fs.readFileSync(sqlitePath()));
  }

  // Per-handle Database instance (do NOT share module sqlJsDb across concurrent remote hydrates)
  const localDb: SqlJsDatabase = bytes ? new SQL.Database(bytes) : new SQL.Database();
  if (mode !== "firestore") {
    if (sqlJsDb) {
      try {
        sqlJsDb.close();
      } catch {
        /* ignore */
      }
    }
    sqlJsDb = localDb;
  }
  try {
    localDb.run("PRAGMA foreign_keys = ON");
  } catch {
    /* ignore */
  }

  let hydratedVersion = remoteVersion;
  /** Suppress persist during migrate/seed so read-only getDb() does not bump the stored version. */
  let persistEnabled = false;

  const runQuery = (sql: string, params: Param[]) => rowsFromSqlJs(localDb, sql, params);
  const execSql = (sql: string) => {
    localDb.exec(sql);
  };
  const persist = async () => {
    if (!persistEnabled) return;
    if (mode === "firestore") {
      hydratedVersion = await persistSqlJsToFirestore(localDb, hydratedVersion);
    } else if (mode === "local-file" || mode === "ephemeral-tmp") {
      persistSqlJsToFile(localDb);
    }
  };

  const isNewDb = !bytes;
  const db = new TmsDb(runQuery, execSql, persist);
  const migrated = await migrate(db);
  const userCount = (await db.prepare("SELECT COUNT(*) as c FROM users").get()) as { c: number } | undefined;
  let seeded = false;
  if (!userCount || Number(userCount.c) === 0) {
    await seed(db);
    // Re-run idempotent migrations so seeded users get reg nos + default password hashes
    await migrate(db);
    seeded = true;
  }
  // Enable persist for subsequent mutations on this handle
  persistEnabled = true;
  // NEVER persist on steady-state reads — only first boot / real schema seed changes.
  // Byte-compare is unsafe: it can re-upload a stale snapshot and undo a clear/create.
  if (seeded || isNewDb || migrated) {
    if (mode === "firestore") {
      try {
        hydratedVersion = await persistSqlJsToFirestore(localDb, hydratedVersion);
      } catch (e) {
        if (e instanceof VersionConflictError && bootDepth < 2 && !opts.fresh) {
          try {
            localDb.close();
          } catch {
            /* ignore */
          }
          // Another instance won the bootstrap write — load their snapshot
          return initSqlJsDb(bootDepth + 1, opts);
        }
        throw e;
      }
    } else if (mode === "local-file" || mode === "ephemeral-tmp") {
      persistSqlJsToFile(localDb);
    }
  }
  return db;
}

async function initTursoDb(): Promise<TmsDb> {
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  tursoClient = client;

  const db = new (class extends TmsDb {
    prepare(sql: string): Stmt {
      return new (class extends Stmt {
        constructor() {
          super(() => ({ rows: [], changes: 0 }), sql, async () => undefined);
        }
        async get(...params: Param[]): Promise<Row | undefined> {
          const rs = await client.execute({ sql, args: params as never[] });
          const row = rs.rows[0];
          return row ? (row as unknown as { toJSON: () => Row }).toJSON() : undefined;
        }
        async all(...params: Param[]): Promise<Row[]> {
          const rs = await client.execute({ sql, args: params as never[] });
          return rs.rows.map((r) => (r as unknown as { toJSON: () => Row }).toJSON());
        }
        async run(...params: Param[]): Promise<{ changes: number }> {
          const rs = await client.execute({ sql, args: params as never[] });
          return { changes: rs.rowsAffected ?? 0 };
        }
      })();
    }
    async exec(sql: string): Promise<void> {
      await client.executeMultiple(sql);
    }
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      await client.execute("BEGIN");
      try {
        const result = await fn();
        await client.execute("COMMIT");
        return result;
      } catch (e) {
        try {
          await client.execute("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    }
    async flush(): Promise<void> {
      /* remote — no-op */
    }
  })((() => ({ rows: [], changes: 0 })), () => undefined, async () => undefined);

  await migrate(db);
  const userCount = (await db.prepare("SELECT COUNT(*) as c FROM users").get()) as { c: number } | undefined;
  if (!userCount || Number(userCount.c) === 0) {
    await seed(db);
    await migrate(db);
  }
  return db;
}

async function initDb(): Promise<TmsDb> {
  if (getDbMode() === "turso") return initTursoDb();
  return initSqlJsDb();
}

/**
 * Shared DB handle.
 * - Turso / local-file: cached for process lifetime.
 * - firestore: ALWAYS re-check the stored version (1 doc read; chunk bytes are cached per
 *   instance and only re-downloaded when the version changed) — multi-instance consistency.
 */
export async function getDb(): Promise<TmsDb> {
  if (getDbMode() === "firestore") {
    return initSqlJsDb();
  }
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

/**
 * Run a mutation against a freshly hydrated DB, retrying on version conflicts.
 * Serializes writers within this serverless instance.
 */
export async function withDbMutation<T>(
  fn: (db: TmsDb) => Promise<T>,
  opts: { retries?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 4;
  return enqueueWrite(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Always start from the latest stored snapshot in firestore mode
        if (getDbMode() === "firestore") {
          dbPromise = null;
          if (sqlJsDb) {
            try {
              sqlJsDb.close();
            } catch {
              /* ignore */
            }
            sqlJsDb = null;
          }
        }
        const db = await getDb();
        return await fn(db);
      } catch (e) {
        lastErr = e;
        if (e instanceof VersionConflictError && attempt < retries - 1) {
          await sleep(30 + Math.floor(Math.random() * 70) * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  });
}

async function migrate(db: TmsDb): Promise<boolean> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT,
      title TEXT,
      registration_no TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      abstract TEXT NOT NULL,
      domain TEXT NOT NULL,
      slots INTEGER NOT NULL DEFAULT 1,
      slots_filled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      faculty_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interests (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id),
      student_id TEXT NOT NULL REFERENCES users(id),
      statement TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      UNIQUE(idea_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      idea_id TEXT REFERENCES ideas(id),
      title TEXT NOT NULL,
      abstract TEXT NOT NULL,
      domain TEXT NOT NULL,
      student_id TEXT NOT NULL REFERENCES users(id),
      supervisor_id TEXT NOT NULL REFERENCES users(id),
      stage TEXT NOT NULL DEFAULT 'gec_formation',
      status TEXT NOT NULL DEFAULT 'draft',
      progress_pct INTEGER NOT NULL DEFAULT 0,
      acb_approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    
    CREATE TABLE IF NOT EXISTS project_students (
      project_id TEXT NOT NULL REFERENCES projects(id),
      student_id TEXT NOT NULL REFERENCES users(id),
      added_at TEXT NOT NULL,
      PRIMARY KEY (project_id, student_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_students_student_active
      ON project_students(student_id);

    CREATE TABLE IF NOT EXISTS gec_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      gec_role TEXT NOT NULL,
      invited_at TEXT NOT NULL,
      accepted_at TEXT,
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      meeting_date TEXT NOT NULL,
      agenda TEXT NOT NULL,
      attendance TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      next_actions TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_pct INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS defences (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      defence_type TEXT NOT NULL,
      scheduled_at TEXT,
      venue TEXT,
      result TEXT NOT NULL DEFAULT 'pending',
      comments TEXT,
      synopsis_doc_id TEXT,
      slides_doc_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      file_name TEXT,
      content_text TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      requires_signatures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      form_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      payload TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role_label TEXT NOT NULL,
      method TEXT NOT NULL,
      signature_data TEXT NOT NULL,
      signed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      actor_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS form_templates (
      id TEXT PRIMARY KEY,
      program_type TEXT NOT NULL,
      code TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      requires_esign INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL,
      UNIQUE(program_type, code)
    );
  `);

  let altered = false;
  altered = (await ensureColumn(db, "ideas", "program_type", "TEXT NOT NULL DEFAULT 'MS_THESIS'")) || altered;
  altered = (await ensureColumn(db, "projects", "program_type", "TEXT NOT NULL DEFAULT 'MS_THESIS'")) || altered;
  altered = (await ensureColumn(db, "users", "registration_no", "TEXT")) || altered;
  const backfilled = await backfillStudentRegistrationNos(db);
  altered = altered || backfilled;

  // 
  // --- passwords ---
  altered = (await ensureColumn(db, "users", "password_hash", "TEXT")) || altered;
  altered = (await ensureColumn(db, "users", "must_change_password", "INTEGER NOT NULL DEFAULT 1")) || altered;

  // --- document vault Google links (no file blobs) ---
  altered = (await ensureColumn(db, "documents", "external_url", "TEXT")) || altered;
  altered = (await ensureColumn(db, "documents", "shared_with_gec", "INTEGER NOT NULL DEFAULT 0")) || altered;

  // --- meetings venue/link + notification read state ---
  altered = (await ensureColumn(db, "meetings", "venue", "TEXT")) || altered;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      user_id TEXT NOT NULL,
      nkey TEXT NOT NULL,
      read_at TEXT,
      dismissed_at TEXT,
      PRIMARY KEY (user_id, nkey)
    );
  `);

  // --- activity monitor: visits, failed logins, richer activity rows ---
  altered = (await ensureColumn(db, "activity", "actor_role", "TEXT")) || altered;
  altered = (await ensureColumn(db, "activity", "actor_name", "TEXT")) || altered;
  altered = (await ensureColumn(db, "activity", "target_url", "TEXT")) || altered;
  altered =
    (await ensureObject(
      db,
      "user_visits",
      `CREATE TABLE IF NOT EXISTS user_visits (
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        page_views INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, date)
      )`
    )) || altered;
  altered =
    (await ensureObject(
      db,
      "login_failures",
      `CREATE TABLE IF NOT EXISTS login_failures (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    )) || altered;
  altered =
    (await ensureObject(db, "idx_user_visits_date", `CREATE INDEX IF NOT EXISTS idx_user_visits_date ON user_visits(date)`)) ||
    altered;
  altered =
    (await ensureObject(
      db,
      "idx_login_failures_created",
      `CREATE INDEX IF NOT EXISTS idx_login_failures_created ON login_failures(created_at)`
    )) || altered;
  altered =
    (await ensureObject(db, "idx_activity_created", `CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at)`)) ||
    altered;
  altered =
    (await ensureObject(db, "idx_activity_actor", `CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity(actor_id, created_at)`)) ||
    altered;

  // --- departments ---
  await db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const deptCount = (await db.prepare("SELECT COUNT(*) as c FROM departments").get()) as { c: number };
  if (Number(deptCount?.c || 0) === 0) {
    const distinct = (await db
      .prepare(
        `SELECT DISTINCT department AS name FROM users
         WHERE department IS NOT NULL AND trim(department) != ''`
      )
      .all()) as { name: string }[];
    const t = now();
    for (const row of distinct) {
      const name = String(row.name).trim();
      if (!name) continue;
      await db
        .prepare(`INSERT OR IGNORE INTO departments (id, name, created_at) VALUES (?, ?, ?)`)
        .run(randomUUID(), name, t);
    }
    // Ensure common defaults exist even on empty user set
    for (const name of [
      "Computer Science",
      "Electrical Engineering",
      "Academic Affairs",
      "External — LUMS",
    ]) {
      await db
        .prepare(`INSERT OR IGNORE INTO departments (id, name, created_at) VALUES (?, ?, ?)`)
        .run(randomUUID(), name, t);
    }
    altered = true;
  }

  // Backfill passwords for users missing a hash (default rule; force change)
  {
    const { hashPassword, defaultPasswordFor } = await import("./passwords");
    const needing = (await db
      .prepare(
        `SELECT id, role, registration_no FROM users
         WHERE password_hash IS NULL OR password_hash = ''`
      )
      .all()) as { id: string; role: string; registration_no: string | null }[];
    for (const u of needing) {
      try {
        const plain = defaultPasswordFor(u.role as import("./types").Role, u.registration_no);
        const hash = await hashPassword(plain);
        await db
          .prepare(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`)
          .run(hash, u.id);
        altered = true;
      } catch (e) {
        console.warn("[db] password backfill skipped for", u.id, e);
      }
    }
  }

  // --- project_students join (group of 1–3); backfill from projects.student_id ---
  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_students (
      project_id TEXT NOT NULL REFERENCES projects(id),
      student_id TEXT NOT NULL REFERENCES users(id),
      added_at TEXT NOT NULL,
      PRIMARY KEY (project_id, student_id)
    );
  `);
  try {
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_project_students_student ON project_students(student_id)`);
  } catch { /* ignore */ }
  const psCount = (await db.prepare('SELECT COUNT(*) as c FROM project_students').get()) as { c: number };
  if (Number(psCount?.c || 0) === 0) {
    const rows = (await db.prepare('SELECT id, student_id, created_at FROM projects WHERE student_id IS NOT NULL').all()) as {
      id: string; student_id: string; created_at: string;
    }[];
    for (const r of rows) {
      await db.prepare(
        `INSERT OR IGNORE INTO project_students (project_id, student_id, added_at) VALUES (?, ?, ?)`
      ).run(r.id, r.student_id, r.created_at || new Date().toISOString());
    }
    if (rows.length) altered = true;
  }
  // Unique among non-null values (SQLite allows multiple NULLs)
  try {
    await db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_registration_no ON users(registration_no)`
    );
  } catch {
    /* index may already exist or conflict on bad data — app still enforces uniqueness */
  }
  const templatesBefore = (await db.prepare("SELECT COUNT(*) as c FROM form_templates").get()) as
    | { c: number }
    | undefined;
  await ensureFormTemplates(db);
  const templatesAfter = (await db.prepare("SELECT COUNT(*) as c FROM form_templates").get()) as
    | { c: number }
    | undefined;
  const templatesSeeded =
    Number(templatesBefore?.c ?? 0) === 0 && Number(templatesAfter?.c ?? 0) > 0;
  // Keep legacy ideas.slots_filled consistent with real group membership (non-destructive)
  {
    const { recomputeSlotsFilled } = await import("./idea-capacity");
    if ((await recomputeSlotsFilled(db)) > 0) altered = true;
  }

  return altered || templatesSeeded;
}

/** Assign placeholder reg nos to students missing one (seeded + legacy imports). */
async function backfillStudentRegistrationNos(db: TmsDb): Promise<boolean> {
  const known: Record<string, string> = {
    "66666666-6666-4666-8666-666666666666": "2026-MS-001",
    "77777777-7777-4777-8777-777777777777": "2026-MS-002",
    "88888888-8888-4888-8888-888888888888": "2026-MS-003",
  };
  const missing = (await db
    .prepare(
      `SELECT id FROM users WHERE role = 'student' AND (registration_no IS NULL OR registration_no = '')`
    )
    .all()) as { id: string }[];
  if (!missing.length) return false;
  let n = 100;
  for (const row of missing) {
    let reg = known[row.id];
    if (!reg) {
      n += 1;
      reg = `2026-MS-${String(n).padStart(3, "0")}`;
      // avoid collision with existing
      while (
        await db.prepare("SELECT id FROM users WHERE registration_no = ?").get(reg)
      ) {
        n += 1;
        reg = `2026-MS-${String(n).padStart(3, "0")}`;
      }
    }
    await db.prepare("UPDATE users SET registration_no = ? WHERE id = ?").run(reg, row.id);
  }
  return true;
}

/** Create a table/index if it does not exist; returns true when it was created. */
async function ensureObject(db: TmsDb, name: string, ddl: string): Promise<boolean> {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(name);
  if (row) return false;
  await db.exec(ddl);
  return true;
}

async function ensureColumn(db: TmsDb, table: string, column: string, ddl: string): Promise<boolean> {
  const cols = await db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    return true;
  }
  return false;
}

export async function ensureFormTemplates(db: TmsDb) {
  const count = (await db.prepare("SELECT COUNT(*) as c FROM form_templates").get()) as
    | { c: number }
    | undefined;
  if (count && Number(count.c) > 0) return;
  await seedFormTemplates(db, "MS_THESIS");
  await seedFormTemplates(db, "FYP");
}

export async function seedFormTemplates(db: TmsDb, program: ProgramType) {
  const insert = db.prepare(
    `INSERT INTO form_templates (id, program_type, code, display_name, description, sort_order, enabled, requires_esign, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of defaultsFor(program)) {
    await insert.run(
      randomUUID(),
      program,
      t.code,
      t.display_name,
      t.description,
      t.sort_order,
      t.enabled,
      t.requires_esign,
      t.category
    );
  }
}

export async function resetFormTemplates(db: TmsDb, program: ProgramType) {
  await db.prepare("DELETE FROM form_templates WHERE program_type = ?").run(program);
  await seedFormTemplates(db, program);
}

export async function getFormTemplates(db: TmsDb, program: ProgramType, enabledOnly = false) {
  if (enabledOnly) {
    return db
      .prepare(
        `SELECT * FROM form_templates WHERE program_type = ? AND enabled = 1 ORDER BY sort_order, display_name`
      )
      .all(program);
  }
  return db
    .prepare(`SELECT * FROM form_templates WHERE program_type = ? ORDER BY sort_order, display_name`)
    .all(program);
}

export async function formDisplayName(db: TmsDb, program: ProgramType, code: string): Promise<string> {
  const row = (await db
    .prepare(`SELECT display_name FROM form_templates WHERE program_type = ? AND code = ?`)
    .get(program, code)) as { display_name: string } | undefined;
  return row?.display_name || code;
}

function now() {
  return new Date().toISOString();
}

/** Days of visit/activity/failed-login history kept (pruned opportunistically during writes). */
export const MONITOR_RETENTION_DAYS = 180;

/** PKT (Asia/Karachi, UTC+5) calendar date key, e.g. "2026-09-28". */
export function pktDateKeyNow(d = new Date()): string {
  return new Date(d.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Upsert today's visit row for a user (PKT date). `pageViews` is added to the counter.
 * Pure SQL on the given handle — callers decide when to write (throttled).
 */
export async function upsertVisit(
  db: TmsDb,
  userId: string,
  pageViews: number,
  at = new Date()
): Promise<void> {
  const iso = at.toISOString();
  await db
    .prepare(
      `INSERT INTO user_visits (user_id, date, first_seen, last_seen, page_views)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         last_seen = CASE WHEN excluded.last_seen > last_seen THEN excluded.last_seen ELSE last_seen END,
         page_views = page_views + excluded.page_views`
    )
    .run(userId, pktDateKeyNow(at), iso, iso, Math.max(0, Math.floor(pageViews || 0)));
}

/** Delete monitor history older than the retention window (cheap indexed deletes). */
export async function pruneMonitorData(db: TmsDb): Promise<void> {
  const cutoff = new Date(Date.now() - MONITOR_RETENTION_DAYS * 86400000);
  const cutoffIso = cutoff.toISOString();
  await db.prepare(`DELETE FROM user_visits WHERE date < ?`).run(pktDateKeyNow(cutoff));
  await db.prepare(`DELETE FROM activity WHERE created_at < ?`).run(cutoffIso);
  await db.prepare(`DELETE FROM login_failures WHERE created_at < ?`).run(cutoffIso);
}

export type ActivityInput = {
  project_id?: string | null;
  actor_id?: string | null;
  /** Actor role snapshot (looked up from users when omitted). */
  actor_role?: string | null;
  /** Actor name snapshot (looked up from users when omitted) — survives user deletion. */
  actor_name?: string | null;
  action: string;
  detail?: string;
  /** Optional in-app link, e.g. /ideas/<id>. Defaults to /projects/<project_id> when a project is given. */
  target_url?: string | null;
};

/**
 * Append an activity row. Runs inside a transaction so it costs at most ONE whole-file
 * Firestore save when called standalone, and nothing extra when the caller is already in a transaction.
 * Also refreshes the actor's visit last_seen for today (no page-view increment).
 */
export async function logActivity(db: TmsDb, opts: ActivityInput) {
  await db.transaction(async () => {
    let role = opts.actor_role ?? null;
    let name = opts.actor_name ?? null;
    if (opts.actor_id && (!role || !name)) {
      const u = (await db.prepare(`SELECT name, role FROM users WHERE id = ?`).get(opts.actor_id)) as
        | { name: string; role: string }
        | undefined;
      role = role ?? u?.role ?? null;
      name = name ?? u?.name ?? null;
    }
    const target =
      opts.target_url ?? (opts.project_id ? `/projects/${opts.project_id}` : null);
    const detail = opts.detail != null ? String(opts.detail).slice(0, 1000) : null;
    await db
      .prepare(
        `INSERT INTO activity (id, project_id, actor_id, actor_role, actor_name, action, detail, target_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        opts.project_id ?? null,
        opts.actor_id ?? null,
        role,
        name,
        opts.action,
        detail,
        target,
        now()
      );
    if (opts.actor_id && name) {
      // actor exists: keep "last seen" fresh as part of the same write
      await upsertVisit(db, opts.actor_id, 0);
    }
  });
}

async function seed(db: TmsDb) {
  const t = now();
  const ids = {
    admin: "11111111-1111-4111-8111-111111111111",
    ahmed: "22222222-2222-4222-8222-222222222222",
    sara: "33333333-3333-4333-8333-333333333333",
    bilal: "44444444-4444-4444-8444-444444444444",
    external: "55555555-5555-4555-8555-555555555555",
    ali: "66666666-6666-4666-8666-666666666666",
    fatima: "77777777-7777-4777-8777-777777777777",
    hassan: "88888888-8888-4888-8888-888888888888",
  };

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, name, role, department, title, registration_no, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const users: [string, string, string, string, string, string, string | null, string][] = [
    [ids.admin, "admin@tms.local", "TMS Admin", "admin", "Academic Affairs", "System Administrator", null, t],
    [ids.ahmed, "ahmed.khan@tms.local", "Dr. Ahmed Khan", "faculty", "Computer Science", "Associate Professor", null, t],
    [ids.sara, "sara.malik@tms.local", "Dr. Sara Malik", "faculty", "Electrical Engineering", "Assistant Professor", null, t],
    [ids.bilal, "bilal.raza@tms.local", "Dr. Bilal Raza", "faculty", "Computer Science", "Professor", null, t],
    [ids.external, "ext.examiner@tms.local", "Prof. Nadia Hussain", "external_examiner", "External — LUMS", "Professor", null, t],
    [ids.ali, "ali.student@tms.local", "Ali Raza", "student", "Computer Science", "MS Student", "2026-MS-001", t],
    [ids.fatima, "fatima.student@tms.local", "Fatima Noor", "student", "Electrical Engineering", "MS Student", "2026-MS-002", t],
    [ids.hassan, "hassan.student@tms.local", "Hassan Mehmood", "student", "Computer Science", "MS Student", "2026-MS-003", t],
  ];

  await db.transaction(async () => {
    for (const u of users) {
      await insertUser.run(...u);
    }
  });
}

export async function clearIdeasAndProjects(db: TmsDb) {
  await db.transaction(async () => {
    await db.prepare("DELETE FROM signatures").run();
    await db.prepare("DELETE FROM documents").run();
    await db.prepare("DELETE FROM forms").run();
    await db.prepare("DELETE FROM meetings").run();
    await db.prepare("DELETE FROM milestones").run();
    await db.prepare("DELETE FROM defences").run();
    await db.prepare("DELETE FROM project_students").run();
    await db.prepare("DELETE FROM gec_members").run();
    await db.prepare("DELETE FROM interests").run();
    await db.prepare("DELETE FROM projects").run();
    await db.prepare("DELETE FROM ideas").run();
    // Activity log is an audit trail (visits/actions monitor) — kept; pruned by retention only.
  });
}

export async function resetDb() {
  dbPromise = null;
  if (sqlJsDb) {
    try {
      sqlJsDb.close();
    } catch {
      /* ignore */
    }
    sqlJsDb = null;
  }
  if (tursoClient) {
    try {
      tursoClient.close();
    } catch {
      /* ignore */
    }
    tursoClient = null;
  }
  const dbFile = sqlitePath();
  for (const f of [dbFile, dbFile + "-wal", dbFile + "-shm"]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  if (getDbMode() === "firestore") {
    // Publish a freshly seeded DB as the next version (version-checked; retried on conflict).
    return withDbMutation(() => initSqlJsDb(0, { fresh: true }));
  }
  return getDb();
}

export { now };
