/**
 * Rebuild a local TMS SQLite file from a read-only JSON/CSV export of the running app.
 *
 * The export contains student personal data. This script never prints row contents.
 * Do not commit the export folder, the tar.gz, or the .sqlite file it writes.
 *
 *   npx tsx scripts/import-from-export.ts <export-folder-or-tar.gz-or-bundle.json> --out data/tms.sqlite
 *
 * Refuses to start when Firebase or Turso credentials are set, so a misconfigured
 * shell cannot publish this file over the live store.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { defaultPasswordFor, hashPassword } from "../src/lib/passwords";
import type { Role } from "../src/lib/types";

const ROLES: Role[] = ["admin", "faculty", "student", "external_examiner"];

const ROLE_FROM_LABEL: Record<string, string> = {
  student: "student",
  faculty: "faculty",
  "external examiner": "external_examiner",
  admin: "admin",
};

type Row = Record<string, unknown>;

type WarningCounts = Record<string, number>;

function warn(counts: WarningCounts, code: string, n = 1) {
  counts[code] = (counts[code] || 0) + n;
}

function isObj(v: unknown): v is Row {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asRows(v: unknown): Row[] {
  if (Array.isArray(v)) return v.filter(isObj);
  return [];
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length ? s : null;
}

function text(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function int(v: unknown, fallback = 0): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return fallback;
}

function jsonText(v: unknown, fallback: string): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function unwrap(data: unknown, keys: string[]): Row[] {
  if (Array.isArray(data)) return asRows(data);
  if (!isObj(data)) return [];
  for (const key of keys) {
    if (Array.isArray(data[key])) return asRows(data[key]);
  }
  return [];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "." || entry.name === "..") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function isExportBundle(data: unknown): data is Record<string, string> {
  if (!isObj(data)) return false;
  const keys = Object.keys(data);
  if (!keys.length) return false;
  const looksLikeFiles = keys.some(
    (key) => key === "users.json" || key === "MANIFEST.md" || key === "activity.csv" || key.includes("/")
  );
  return looksLikeFiles && keys.every((key) => typeof data[key] === "string");
}

/** Write a path→text bundle into dest. Rejects absolute paths and `..`. */
function unpackBundle(data: Record<string, string>, dest: string) {
  for (const rel of Object.keys(data)) {
    if (!rel || path.isAbsolute(rel) || rel.split(/[/\\]/).includes("..")) {
      throw new Error("Export bundle contains an unsafe path");
    }
  }
  for (const [rel, text] of Object.entries(data)) {
    const full = path.join(dest, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

function findExportRoot(input: string): { root: string; cleanup?: () => void } {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) {
    throw new Error(`Export not found: ${abs}`);
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) return { root: abs };
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "tms-export-"));
  const cleanup = () => fs.rmSync(dest, { recursive: true, force: true });
  if (/\.json$/i.test(abs)) {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
    if (!isExportBundle(parsed)) {
      cleanup();
      throw new Error(`JSON file is not an export bundle (expected path → text): ${abs}`);
    }
    unpackBundle(parsed, dest);
    return { root: dest, cleanup };
  }
  if (!/\.(tar\.gz|tgz)$/i.test(abs)) {
    cleanup();
    throw new Error(`Expected a directory, a .tar.gz archive, or a bundle .json file, got ${abs}`);
  }
  execFileSync("tar", ["-xzf", abs, "-C", dest], { stdio: "pipe" });
  const entries = fs.readdirSync(dest).filter((name) => name !== "." && name !== "..");
  let root = dest;
  if (entries.length === 1) {
    const only = path.join(dest, entries[0]);
    if (fs.statSync(only).isDirectory()) root = only;
  }
  return { root, cleanup };
}

type Loaded = {
  users: Row[];
  departments: Row[];
  templates: Row[];
  ideas: Map<string, Row>;
  interests: Row[];
  projects: Map<string, Row>;
  projectDetails: Map<string, Row>;
  activityCsv: string | null;
  manifest: Record<string, number>;
  manifestUnrecognized: number;
  files: number;
};

function normalizeManifestKey(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[_./]+/g, " ").replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    user: "users",
    users: "users",
    "users.json": "users",
    department: "departments",
    departments: "departments",
    "form template": "form_templates",
    "form templates": "form_templates",
    form_templates: "form_templates",
    templates: "form_templates",
    "form templates fyp": "form_templates_fyp",
    "form templates ms thesis": "form_templates_ms",
    "form templates ms": "form_templates_ms",
    idea: "ideas",
    ideas: "ideas",
    interest: "interests",
    interests: "interests",
    project: "projects",
    projects: "projects",
    "project student": "project_students",
    "project students": "project_students",
    project_students: "project_students",
    gec: "gec_members",
    "gec member": "gec_members",
    "gec members": "gec_members",
    gec_members: "gec_members",
    meeting: "meetings",
    meetings: "meetings",
    milestone: "milestones",
    milestones: "milestones",
    defence: "defences",
    defences: "defences",
    defense: "defences",
    defenses: "defences",
    document: "documents",
    documents: "documents",
    form: "forms",
    forms: "forms",
    signature: "signatures",
    signatures: "signatures",
    activity: "activity",
    "activity rows": "activity",
    "activity.csv": "activity",
  };
  return aliases[s] || aliases[s.replace(/\.json$/, "")] || null;
}

function parseManifest(text: string): { counts: Record<string, number>; unrecognized: number } {
  const counts: Record<string, number> = {};
  let unrecognized = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let label = "";
    let value = "";
    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && /^\d+$/.test(cells[cells.length - 1].replace(/,/g, ""))) {
      label = cells[0];
      value = cells[cells.length - 1];
    } else {
      const m = trimmed.match(/^[-*]?\s*([^:=]{1,60}?)\s*[:=]\s*(\d[\d,]*)\b/);
      if (!m) continue;
      label = m[1];
      value = m[2];
    }
    if (/^(-|table|count|name)$/i.test(label)) continue;
    const key = normalizeManifestKey(label);
    if (!key) {
      if (/\d/.test(value)) unrecognized += 1;
      continue;
    }
    const n = Number(value.replace(/,/g, ""));
    if (key === "form_templates_fyp" || key === "form_templates_ms") {
      counts[key] = n;
      continue;
    }
    counts[key] = n;
  }
  if (counts.form_templates == null && (counts.form_templates_fyp != null || counts.form_templates_ms != null)) {
    counts.form_templates = (counts.form_templates_fyp || 0) + (counts.form_templates_ms || 0);
  }
  return { counts, unrecognized };
}

function loadExport(root: string): Loaded {
  const files = walk(root);
  const loaded: Loaded = {
    users: [],
    departments: [],
    templates: [],
    ideas: new Map(),
    interests: [],
    projects: new Map(),
    projectDetails: new Map(),
    activityCsv: null,
    manifest: {},
    manifestUnrecognized: 0,
    files: files.length,
  };
  for (const file of files) {
    const base = path.basename(file).toLowerCase();
    const rel = path.relative(root, file).replace(/\\/g, "/").toLowerCase();
    if (base === "manifest.md") {
      const parsed = parseManifest(fs.readFileSync(file, "utf8"));
      loaded.manifest = parsed.counts;
      loaded.manifestUnrecognized = parsed.unrecognized;
      continue;
    }
    if (base === "activity.csv") {
      loaded.activityCsv = fs.readFileSync(file, "utf8");
      continue;
    }
    if (!base.endsWith(".json")) continue;
    const data = readJson(file);
    if (base === "users.json" || (isObj(data) && Array.isArray(data.users))) {
      loaded.users.push(...unwrap(data, ["users"]));
      continue;
    }
    if (base.startsWith("department")) {
      loaded.departments.push(...unwrap(data, ["departments"]));
      continue;
    }
    if (base.includes("template") || rel.includes("template") || (isObj(data) && Array.isArray(data.templates))) {
      const program = isObj(data) && typeof data.program === "string" ? data.program : null;
      for (const row of unwrap(data, ["templates", "form_templates"])) {
        if (program && row.program_type == null) row.program_type = program;
        loaded.templates.push(row);
      }
      continue;
    }
    if (base === "ideas.json" || (isObj(data) && Array.isArray(data.ideas) && !isObj(data.idea))) {
      for (const idea of unwrap(data, ["ideas"])) {
        const id = str(idea.id);
        if (id) loaded.ideas.set(id, { ...loaded.ideas.get(id), ...idea });
      }
      continue;
    }
    if (rel.startsWith("ideas/") || (isObj(data) && isObj(data.idea))) {
      const idea = isObj(data) && isObj(data.idea) ? data.idea : isObj(data) ? data : null;
      if (idea) {
        const id = str(idea.id);
        if (id) loaded.ideas.set(id, { ...loaded.ideas.get(id), ...idea });
      }
      const interests = isObj(data) ? unwrap(data, ["interests"]) : [];
      loaded.interests.push(...interests);
      continue;
    }
    if (base === "projects.json" || (isObj(data) && Array.isArray(data.projects) && !isObj(data.project))) {
      for (const project of unwrap(data, ["projects"])) {
        const id = str(project.id);
        if (id) loaded.projects.set(id, { ...loaded.projects.get(id), ...project });
      }
      continue;
    }
    if (rel.startsWith("projects/") || (isObj(data) && isObj(data.project))) {
      const body = isObj(data) ? data : {};
      const project = isObj(body.project) ? body.project : null;
      const id = project ? str(project.id) : null;
      if (project && id) {
        loaded.projects.set(id, { ...loaded.projects.get(id), ...project });
        loaded.projectDetails.set(id, body);
      }
    }
  }
  return loaded;
}

/** RFC-style CSV split. Strips a leading UTF-8 BOM. */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (c === "\r") continue;
    cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Activity CSV times are minute-precision Pakistan time, e.g. "17 Oct 2026, 18:43 PKT". */
function parsePkt(value: string, counts: WarningCounts): string | null {
  const raw = value
    .trim()
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s*PKT$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const monthNamed = raw.match(
    /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:,|\s+at)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i
  );
  if (monthNamed) {
    const month = MONTHS[monthNamed[2].slice(0, 3).toLowerCase()];
    if (month == null) {
      warn(counts, "activity_unparsed_time");
      return null;
    }
    const utc = Date.UTC(
      Number(monthNamed[3]),
      month,
      Number(monthNamed[1]),
      Number(monthNamed[4]) - 5,
      Number(monthNamed[5]),
      Number(monthNamed[6] || 0)
    );
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) {
      warn(counts, "activity_unparsed_time");
      return null;
    }
    return d.toISOString();
  }
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (dmy) {
    const utc = Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4]) - 5, Number(dmy[5]), Number(dmy[6] || 0));
    const d = new Date(utc);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  warn(counts, "activity_unparsed_time");
  return null;
}

function pktMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pkt = new Date(d.getTime() + 5 * 3600 * 1000);
  return pkt.toISOString().slice(0, 16);
}

function undoFormulaGuard(value: string): string {
  if (value.startsWith("'") && /^[=+\-@\t]/.test(value.slice(1))) return value.slice(1);
  return value;
}

function projectIdFromLink(link: string): string | null {
  const m = link.match(/\/projects\/([0-9a-fA-F-]{36})/);
  return m ? m[1] : null;
}

function targetUrlFromLink(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

type ActivityInsert = {
  id: string;
  project_id: string | null;
  actor_id: string | null;
  actor_role: string | null;
  actor_name: string | null;
  action: string;
  detail: string | null;
  target_url: string | null;
  created_at: string;
};

function activityKey(row: ActivityInsert): string {
  return [
    pktMinute(row.created_at),
    row.action,
    row.project_id || "",
    row.detail || "",
    row.actor_id || (row.actor_name || "").toLowerCase(),
  ].join("|");
}

function buildActivity(loaded: Loaded, usersByEmail: Map<string, Row>, counts: WarningCounts): ActivityInsert[] {
  const csvRows: ActivityInsert[] = [];
  if (loaded.activityCsv) {
    const table = parseCsv(loaded.activityCsv);
    const header = (table[0] || []).map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const iTime = idx("time (pkt)");
    const iUser = idx("user");
    const iEmail = idx("email");
    const iRole = idx("role");
    const iAction = idx("action code");
    const iDetail = idx("details");
    const iLink = idx("link");
    if (iAction < 0 || iTime < 0) {
      warn(counts, "activity_csv_header_unrecognized");
    } else {
      for (const cells of table.slice(1)) {
        const action = undoFormulaGuard(cells[iAction] || "").trim();
        if (!action) {
          warn(counts, "activity_row_skipped");
          continue;
        }
        const created = parsePkt(cells[iTime] || "", counts);
        if (!created) {
          warn(counts, "activity_row_skipped");
          continue;
        }
        const email = (cells[iEmail] || "").trim().toLowerCase();
        const user = email ? usersByEmail.get(email) : undefined;
        if (email && !user) warn(counts, "activity_unmatched_actor");
        const link = cells[iLink] || "";
        const projectId = projectIdFromLink(link);
        if (link.trim() && !projectId) warn(counts, "activity_link_not_a_project");
        const roleLabel = (cells[iRole] || "").trim().toLowerCase();
        const actorNameRaw = undoFormulaGuard(cells[iUser] || "").trim();
        const actorName = !actorNameRaw || (actorNameRaw === "System" && !email) ? null : actorNameRaw;
        const detailRaw = undoFormulaGuard(cells[iDetail] || "");
        csvRows.push({
          id: randomUUID(),
          project_id: projectId,
          actor_id: user ? str(user.id) : null,
          actor_role: ROLE_FROM_LABEL[roleLabel] || (user ? str(user.role) : null),
          actor_name: actorName,
          action,
          detail: detailRaw.trim() ? detailRaw : null,
          target_url: targetUrlFromLink(link),
          created_at: created,
        });
      }
    }
  }

  const used = new Set<number>();
  const merged: ActivityInsert[] = [];
  const rich: ActivityInsert[] = [];
  for (const [projectId, detail] of Array.from(loaded.projectDetails.entries())) {
    for (const row of asRows(detail.activity)) {
      const action = str(row.action);
      const created = str(row.created_at);
      if (!action || !created) {
        warn(counts, "activity_row_skipped");
        continue;
      }
      rich.push({
        id: str(row.id) || randomUUID(),
        project_id: str(row.project_id) || projectId,
        actor_id: str(row.actor_id),
        actor_role: str(row.actor_role),
        actor_name: str(row.actor_name),
        action,
        detail: str(row.detail),
        target_url: str(row.target_url),
        created_at: created,
      });
    }
  }

  function sameEvent(a: ActivityInsert, b: ActivityInsert): boolean {
    if (a.action !== b.action) return false;
    if ((a.project_id || "") !== (b.project_id || "")) return false;
    if ((a.detail || "") !== (b.detail || "")) return false;
    if (pktMinute(a.created_at) !== pktMinute(b.created_at)) return false;
    if (a.actor_id && b.actor_id) return a.actor_id === b.actor_id;
    if (a.actor_name && b.actor_name) return a.actor_name.toLowerCase() === b.actor_name.toLowerCase();
    return true;
  }

  for (const row of csvRows) {
    const matchAt = rich.findIndex((candidate, index) => !used.has(index) && sameEvent(row, candidate));
    if (matchAt >= 0) {
      used.add(matchAt);
      const exact = rich[matchAt];
      merged.push({
        ...row,
        id: exact.id,
        created_at: exact.created_at,
        actor_id: exact.actor_id || row.actor_id,
        actor_role: exact.actor_role || row.actor_role,
        actor_name: exact.actor_name || row.actor_name,
        target_url: exact.target_url || row.target_url,
        project_id: exact.project_id || row.project_id,
      });
    } else {
      merged.push(row);
    }
  }
  for (let i = 0; i < rich.length; i++) {
    if (!used.has(i)) {
      merged.push(rich[i]);
      warn(counts, "activity_only_on_project_json");
    }
  }
  const seen = new Set<string>();
  const deduped: ActivityInsert[] = [];
  for (const row of merged) {
    const key = row.id + "|" + activityKey(row);
    if (seen.has(key)) {
      warn(counts, "activity_duplicate_skipped");
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function requireId(row: Row, counts: WarningCounts, code: string): string | null {
  const id = str(row.id);
  if (!id) warn(counts, code);
  return id;
}

function stamp(row: Row, key: string, counts: WarningCounts): string {
  const value = str(row[key]);
  if (value) return value;
  warn(counts, "synthesized_timestamps");
  return "1970-01-01T00:00:00.000Z";
}

async function main() {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf("--out");
  const outPath = outFlag >= 0 ? args[outFlag + 1] : "";
  const sqlFlag = args.indexOf("--sql");
  const sqlPath = sqlFlag >= 0 ? args[sqlFlag + 1] : "";
  const skip = new Set<number>();
  if (outFlag >= 0) skip.add(outFlag + 1);
  if (sqlFlag >= 0) skip.add(sqlFlag + 1);
  const input = args.find((arg, index) => !arg.startsWith("--") && !skip.has(index));
  if (!input || !outPath) {
    console.error(
      "usage: npx tsx scripts/import-from-export.ts <export-folder-or-tar.gz-or-bundle.json> --out <file.sqlite> [--sql <file.sql>]"
    );
    process.exit(1);
  }
  if (
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_CLIENT_EMAIL ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.TURSO_DATABASE_URL ||
    process.env.TURSO_AUTH_TOKEN ||
    process.env.VERCEL ||
    process.env.NETLIFY
  ) {
    console.error("Refusing to import while Firebase, Turso, Vercel, or Netlify env is set.");
    process.exit(1);
  }

  const { root, cleanup } = findExportRoot(input);
  const counts: WarningCounts = {};
  try {
    const loaded = loadExport(root);
    const localFile = path.join(process.cwd(), "data", "tms.sqlite");
    fs.rmSync(localFile, { force: true });
    fs.rmSync(localFile + "-wal", { force: true });
    fs.rmSync(localFile + "-shm", { force: true });

    const { getDb } = await import("../src/lib/db");
    const db = await getDb();

    const usersByEmail = new Map<string, Row>();
    for (const user of loaded.users) {
      const email = str(user.email);
      if (email) usersByEmail.set(email.toLowerCase(), user);
    }
    const activity = buildActivity(loaded, usersByEmail, counts);

    const inserted: Record<string, number> = {};
    const bump = (table: string) => {
      inserted[table] = (inserted[table] || 0) + 1;
    };

    await db.exec("PRAGMA foreign_keys = OFF");
    await db.transaction(async () => {
      for (const table of [
        "signatures",
        "documents",
        "forms",
        "meetings",
        "milestones",
        "defences",
        "project_students",
        "gec_members",
        "interests",
        "projects",
        "ideas",
        "activity",
        "notification_reads",
        "user_visits",
        "login_failures",
        "form_templates",
        "departments",
        "users",
      ]) {
        await db.prepare(`DELETE FROM ${table}`).run();
      }

      for (const user of loaded.users) {
        const id = requireId(user, counts, "user_missing_id");
        const email = str(user.email);
        const name = str(user.name);
        const role = str(user.role);
        if (!id || !email || !name || !role || !ROLES.includes(role as Role)) {
          warn(counts, "user_row_skipped");
          continue;
        }
        let registration = str(user.registration_no);
        if (registration) registration = registration.trim();
        let plain: string;
        try {
          plain = defaultPasswordFor(role as Role, registration);
        } catch {
          warn(counts, "student_missing_registration");
          plain = defaultPasswordFor("faculty", null);
        }
        const password_hash = await hashPassword(plain);
        try {
          await db
            .prepare(
              `INSERT INTO users (id, email, name, role, department, title, registration_no, password_hash, must_change_password, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
            )
            .run(
              id,
              email,
              name,
              role,
              str(user.department),
              str(user.title),
              registration,
              password_hash,
              stamp(user, "created_at", counts)
            );
          bump("users");
        } catch {
          warn(counts, "user_row_skipped");
        }
      }

      for (const dept of loaded.departments) {
        const id = requireId(dept, counts, "department_missing_id");
        const name = str(dept.name);
        if (!id || !name) {
          warn(counts, "department_row_skipped");
          continue;
        }
        try {
          await db
            .prepare(`INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)`)
            .run(id, name, stamp(dept, "created_at", counts));
          bump("departments");
        } catch {
          warn(counts, "department_row_skipped");
        }
      }

      for (const tpl of loaded.templates) {
        const id = requireId(tpl, counts, "template_missing_id");
        const program = str(tpl.program_type);
        const code = str(tpl.code);
        const display = str(tpl.display_name);
        const category = str(tpl.category);
        if (!id || !program || !code || !display || !category) {
          warn(counts, "template_row_skipped");
          continue;
        }
        try {
          await db
            .prepare(
              `INSERT INTO form_templates (id, program_type, code, display_name, description, sort_order, enabled, requires_esign, category)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              id,
              program,
              code,
              display,
              str(tpl.description),
              int(tpl.sort_order),
              int(tpl.enabled, 1),
              int(tpl.requires_esign, 1),
              category
            );
          bump("form_templates");
        } catch {
          warn(counts, "template_row_skipped");
        }
      }

      for (const idea of Array.from(loaded.ideas.values())) {
        const id = requireId(idea, counts, "idea_missing_id");
        if (!id || !str(idea.title) || !str(idea.faculty_id)) {
          warn(counts, "idea_row_skipped");
          continue;
        }
        const slotsFilled = idea.places_filled != null ? int(idea.places_filled) : int(idea.slots_filled);
        try {
          await db
            .prepare(
              `INSERT INTO ideas (id, title, abstract, domain, slots, slots_filled, status, faculty_id, created_at, updated_at, program_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              id,
              text(idea.title),
              text(idea.abstract),
              text(idea.domain),
              int(idea.slots, 1),
              slotsFilled,
              str(idea.status) || "open",
              str(idea.faculty_id),
              stamp(idea, "created_at", counts),
              stamp(idea, "updated_at", counts),
              str(idea.program_type) || "MS_THESIS"
            );
          bump("ideas");
        } catch {
          warn(counts, "idea_row_skipped");
        }
      }

      for (const interest of loaded.interests) {
        const id = requireId(interest, counts, "interest_missing_id");
        if (!id || !str(interest.idea_id) || !str(interest.student_id)) {
          warn(counts, "interest_row_skipped");
          continue;
        }
        try {
          await db
            .prepare(
              `INSERT INTO interests (id, idea_id, student_id, statement, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
              id,
              str(interest.idea_id),
              str(interest.student_id),
              str(interest.statement),
              str(interest.status) || "pending",
              stamp(interest, "created_at", counts)
            );
          bump("interests");
        } catch {
          warn(counts, "interest_row_skipped");
        }
      }

      for (const project of Array.from(loaded.projects.values())) {
        const id = requireId(project, counts, "project_missing_id");
        if (!id || !str(project.title) || !str(project.student_id) || !str(project.supervisor_id)) {
          warn(counts, "project_row_skipped");
          continue;
        }
        try {
          await db
            .prepare(
              `INSERT INTO projects (id, idea_id, title, abstract, domain, student_id, supervisor_id, stage, status, progress_pct, acb_approved, created_at, updated_at, program_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              id,
              str(project.idea_id),
              text(project.title),
              text(project.abstract),
              text(project.domain),
              str(project.student_id),
              str(project.supervisor_id),
              str(project.stage) || "gec_formation",
              str(project.status) || "draft",
              int(project.progress_pct),
              int(project.acb_approved),
              stamp(project, "created_at", counts),
              stamp(project, "updated_at", counts),
              str(project.program_type) || "MS_THESIS"
            );
          bump("projects");
        } catch {
          warn(counts, "project_row_skipped");
        }
      }

      const seenStudents = new Set<string>();
      for (const [projectId, detail] of Array.from(loaded.projectDetails.entries())) {
        const nested = isObj(detail.project) ? asRows((detail.project as Row).students) : [];
        const students = asRows(detail.students).length ? asRows(detail.students) : nested;
        const project = loaded.projects.get(projectId);
        const rows = students.length
          ? students
          : project && str(project.student_id)
            ? [{ project_id: projectId, student_id: project.student_id, added_at: project.created_at }]
            : [];
        for (const student of rows) {
          const studentId = str(student.student_id);
          if (!studentId) {
            warn(counts, "project_student_skipped");
            continue;
          }
          const key = projectId + "|" + studentId;
          if (seenStudents.has(key)) continue;
          seenStudents.add(key);
          try {
            await db
              .prepare(`INSERT INTO project_students (project_id, student_id, added_at) VALUES (?, ?, ?)`)
              .run(projectId, studentId, str(student.added_at) || stamp(project || {}, "created_at", counts));
            bump("project_students");
          } catch {
            warn(counts, "project_student_skipped");
          }
        }
        for (const gec of asRows(detail.gec)) {
          const id = requireId(gec, counts, "gec_missing_id");
          if (!id || !str(gec.user_id) || !str(gec.gec_role)) {
            warn(counts, "gec_row_skipped");
            continue;
          }
          try {
            await db
              .prepare(
                `INSERT INTO gec_members (id, project_id, user_id, gec_role, invited_at, accepted_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
              )
              .run(
                id,
                str(gec.project_id) || projectId,
                str(gec.user_id),
                str(gec.gec_role),
                stamp(gec, "invited_at", counts),
                str(gec.accepted_at)
              );
            bump("gec_members");
          } catch {
            warn(counts, "gec_row_skipped");
          }
        }
        for (const meeting of asRows(detail.meetings)) {
          const id = requireId(meeting, counts, "meeting_missing_id");
          if (!id) {
            warn(counts, "meeting_row_skipped");
            continue;
          }
          try {
            await db
              .prepare(
                `INSERT INTO meetings (id, project_id, meeting_date, agenda, attendance, notes, next_actions, created_by, created_at, venue)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                id,
                str(meeting.project_id) || projectId,
                stamp(meeting, "meeting_date", counts),
                text(meeting.agenda),
                jsonText(meeting.attendance, "[]"),
                text(meeting.notes),
                text(meeting.next_actions),
                str(meeting.created_by) || str(project?.supervisor_id) || "",
                stamp(meeting, "created_at", counts),
                str(meeting.venue)
              );
            bump("meetings");
          } catch {
            warn(counts, "meeting_row_skipped");
          }
        }
        for (const milestone of asRows(detail.milestones)) {
          const id = requireId(milestone, counts, "milestone_missing_id");
          if (!id || !str(milestone.title)) {
            warn(counts, "milestone_row_skipped");
            continue;
          }
          try {
            await db
              .prepare(
                `INSERT INTO milestones (id, project_id, title, description, due_date, status, progress_pct, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                id,
                str(milestone.project_id) || projectId,
                text(milestone.title),
                str(milestone.description),
                str(milestone.due_date),
                str(milestone.status) || "pending",
                int(milestone.progress_pct),
                stamp(milestone, "updated_at", counts)
              );
            bump("milestones");
          } catch {
            warn(counts, "milestone_row_skipped");
          }
        }
        for (const defence of asRows(detail.defences)) {
          const id = requireId(defence, counts, "defence_missing_id");
          if (!id || !str(defence.defence_type)) {
            warn(counts, "defence_row_skipped");
            continue;
          }
          try {
            await db
              .prepare(
                `INSERT INTO defences (id, project_id, defence_type, scheduled_at, venue, result, comments, synopsis_doc_id, slides_doc_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                id,
                str(defence.project_id) || projectId,
                str(defence.defence_type),
                str(defence.scheduled_at),
                str(defence.venue),
                str(defence.result) || "pending",
                str(defence.comments),
                str(defence.synopsis_doc_id),
                str(defence.slides_doc_id),
                stamp(defence, "created_at", counts),
                stamp(defence, "updated_at", counts)
              );
            bump("defences");
          } catch {
            warn(counts, "defence_row_skipped");
          }
        }
        for (const document of asRows(detail.documents)) {
          const id = requireId(document, counts, "document_missing_id");
          if (!id || !str(document.title) || !str(document.doc_type)) {
            warn(counts, "document_row_skipped");
            continue;
          }
          try {
            await db
              .prepare(
                `INSERT INTO documents (id, project_id, title, doc_type, version, file_name, content_text, uploaded_by, requires_signatures, created_at, external_url, shared_with_gec)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                id,
                str(document.project_id) || projectId,
                text(document.title),
                str(document.doc_type),
                int(document.version, 1),
                str(document.file_name),
                str(document.content_text),
                str(document.uploaded_by) || str(project?.supervisor_id) || "",
                int(document.requires_signatures),
                stamp(document, "created_at", counts),
                str(document.external_url),
                int(document.shared_with_gec)
              );
            bump("documents");
          } catch {
            warn(counts, "document_row_skipped");
          }
          for (const sig of asRows(document.signatures)) {
            await insertSignature(db, sig, "document", id, projectId, counts, bump);
          }
        }
        for (const form of asRows(detail.forms)) {
          const id = requireId(form, counts, "form_missing_id");
          if (!id || !str(form.form_type)) {
            warn(counts, "form_row_skipped");
            continue;
          }
          try {
            await db
              .prepare(
                `INSERT INTO forms (id, project_id, form_type, status, payload, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                id,
                str(form.project_id) || projectId,
                str(form.form_type),
                str(form.status) || "draft",
                jsonText(form.payload, "{}"),
                str(form.created_by) || str(project?.supervisor_id) || "",
                stamp(form, "created_at", counts),
                stamp(form, "updated_at", counts)
              );
            bump("forms");
          } catch {
            warn(counts, "form_row_skipped");
          }
          for (const sig of asRows(form.signatures)) {
            await insertSignature(db, sig, "form", id, projectId, counts, bump);
          }
        }
      }

      for (const [projectId, project] of Array.from(loaded.projects.entries())) {
        if (Array.from(seenStudents).some((key) => key.startsWith(projectId + "|"))) continue;
        const studentId = str(project.student_id);
        if (!studentId) continue;
        try {
          await db
            .prepare(`INSERT INTO project_students (project_id, student_id, added_at) VALUES (?, ?, ?)`)
            .run(projectId, studentId, stamp(project, "created_at", counts));
          bump("project_students");
          warn(counts, "project_student_backfilled_from_primary");
        } catch {
          warn(counts, "project_student_skipped");
        }
      }

      for (const row of activity) {
        try {
          await db
            .prepare(
              `INSERT INTO activity (id, project_id, actor_id, action, detail, created_at, actor_role, actor_name, target_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              row.id,
              row.project_id,
              row.actor_id,
              row.action,
              row.detail,
              row.created_at,
              row.actor_role,
              row.actor_name,
              row.target_url
            );
          bump("activity");
        } catch {
          warn(counts, "activity_row_skipped");
        }
      }
    });

    const tables = [
      "users",
      "departments",
      "form_templates",
      "ideas",
      "interests",
      "projects",
      "project_students",
      "gec_members",
      "meetings",
      "milestones",
      "defences",
      "documents",
      "forms",
      "signatures",
      "activity",
      "login_failures",
      "notification_reads",
      "user_visits",
    ];
    const dbCounts: Record<string, number> = {};
    for (const table of tables) {
      const row = (await db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get()) as { c: number };
      dbCounts[table] = Number(row?.c || 0);
    }
    const mustChange = (await db.prepare(`SELECT COUNT(*) as c FROM users WHERE must_change_password = 1`).get()) as {
      c: number;
    };
    const missingHash = (await db
      .prepare(`SELECT COUNT(*) as c FROM users WHERE password_hash IS NULL OR password_hash = ''`)
      .get()) as { c: number };
    const dangling = async (sql: string) => {
      const row = (await db.prepare(sql).get()) as { c: number };
      return Number(row?.c || 0);
    };
    const danglingCounts = {
      ideas_missing_faculty: await dangling(
        `SELECT COUNT(*) as c FROM ideas i LEFT JOIN users u ON u.id = i.faculty_id WHERE u.id IS NULL`
      ),
      interests_missing_student: await dangling(
        `SELECT COUNT(*) as c FROM interests x LEFT JOIN users u ON u.id = x.student_id WHERE u.id IS NULL`
      ),
      projects_missing_student: await dangling(
        `SELECT COUNT(*) as c FROM projects p LEFT JOIN users u ON u.id = p.student_id WHERE u.id IS NULL`
      ),
      projects_missing_supervisor: await dangling(
        `SELECT COUNT(*) as c FROM projects p LEFT JOIN users u ON u.id = p.supervisor_id WHERE u.id IS NULL`
      ),
      gec_missing_user: await dangling(
        `SELECT COUNT(*) as c FROM gec_members g LEFT JOIN users u ON u.id = g.user_id WHERE u.id IS NULL`
      ),
    };

    let gecSource = 0;
    for (const detail of Array.from(loaded.projectDetails.values())) gecSource += asRows(detail.gec).length;
    const source: Record<string, number> = {
      users: loaded.users.length,
      departments: loaded.departments.length,
      form_templates: loaded.templates.length,
      ideas: loaded.ideas.size,
      interests: loaded.interests.length,
      projects: loaded.projects.size,
      gec_members: gecSource,
      activity: activity.length,
      files: loaded.files,
    };

    const summary = {
      files: loaded.files,
      source,
      inserted,
      db: dbCounts,
      manifest: loaded.manifest,
      manifestUnrecognized: loaded.manifestUnrecognized,
      warnings: counts,
      users_must_change_password: Number(mustChange?.c || 0),
      users_missing_hash: Number(missingHash?.c || 0),
      dangling: danglingCounts,
    };
    console.log(JSON.stringify(summary, null, 2));

    const dest = path.resolve(outPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (path.resolve(localFile) !== dest) fs.copyFileSync(localFile, dest);
    if (sqlPath) {
      const dump = execFileSync("sqlite3", [localFile, ".dump"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const sqlDest = path.resolve(sqlPath);
      fs.mkdirSync(path.dirname(sqlDest), { recursive: true });
      fs.writeFileSync(sqlDest, dump);
    }

    const mismatches: string[] = [];
    for (const [key, expected] of Object.entries(loaded.manifest)) {
      if (key.startsWith("form_templates_")) continue;
      if (dbCounts[key] == null) continue;
      if (dbCounts[key] !== expected) mismatches.push(`${key}: db ${dbCounts[key]} vs manifest ${expected}`);
    }
    if (mismatches.length) {
      console.error("Manifest counts differ:");
      for (const line of mismatches) console.error("  " + line);
      process.exitCode = 2;
    }
  } finally {
    cleanup?.();
  }
}

async function insertSignature(
  db: { prepare(sql: string): { run(...params: unknown[]): Promise<unknown> } },
  sig: Row,
  targetType: string,
  targetId: string,
  projectId: string,
  counts: WarningCounts,
  bump: (table: string) => void
) {
  const id = requireId(sig, counts, "signature_missing_id");
  if (!id || !str(sig.user_id)) {
    warn(counts, "signature_row_skipped");
    return;
  }
  try {
    await db
      .prepare(
        `INSERT INTO signatures (id, target_type, target_id, project_id, user_id, role_label, method, signature_data, signed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        str(sig.target_type) || targetType,
        str(sig.target_id) || targetId,
        str(sig.project_id) || projectId,
        str(sig.user_id),
        str(sig.role_label) || "",
        str(sig.method) || "typed",
        text(sig.signature_data),
        stamp(sig, "signed_at", counts)
      );
    bump("signatures");
  } catch {
    warn(counts, "signature_row_skipped");
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
