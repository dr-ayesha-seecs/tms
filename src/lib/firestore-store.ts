/**
 * Firestore persistence for the TMS SQLite snapshot.
 *
 * The app keeps all of its data in one small SQLite database (sql.js, in memory). This module
 * stores that database file in Firebase Firestore so it survives across serverless instances:
 *
 *   {collection}/meta                         { version, updatedAt, snapshotId, chunkCount, size, sha256 }
 *   {collection}/v{version}_{snapshotId}_c{n}  { kind: "chunk", version, snapshotId, index, data: Bytes }
 *
 * - The file is split into chunks well below Firestore's 1 MiB document limit.
 * - A save first writes brand-new chunk docs (unique per writer, so two racing writers can never
 *   overwrite each other's chunks), then publishes them by updating `meta` inside a Firestore
 *   transaction that checks the version (optimistic concurrency). A reader therefore never sees a
 *   half-written database. Older chunk docs are deleted after a successful publish.
 * - Reads fetch `meta`, then that version's chunks, and verify size + sha256.
 *
 * Credentials come from env only (never from files in the repo):
 *   FIREBASE_SERVICE_ACCOUNT_BASE64   base64 of the whole service-account JSON (preferred), or
 *   FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 * Collection: TMS_FIRESTORE_COLLECTION (default "tms_db"; must start with "tms_" because the
 * Firebase project may be shared with other apps — this module never touches other collections).
 */
import { createHash, randomBytes } from "crypto";
import type { App } from "firebase-admin/app";
import type { Firestore } from "firebase-admin/firestore";

export const DEFAULT_COLLECTION = "tms_db";
/** Firestore max doc size is 1 MiB; keep chunks comfortably below it. */
export const CHUNK_SIZE = 800 * 1024;

export type FirestoreMeta = {
  version: number;
  updatedAt: string;
  snapshotId: string;
  chunkCount: number;
  size: number;
  sha256: string;
};

export type FirestoreSnapshot = { meta: FirestoreMeta; bytes: Uint8Array };

type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string };

export class FirestoreVersionConflict extends Error {
  constructor(
    public expected: number,
    public actual: number
  ) {
    super(`Firestore DB version conflict: expected ${expected}, found ${actual}`);
    this.name = "FirestoreVersionConflict";
  }
}

export class FirestoreStoreError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "FirestoreStoreError";
  }
}

function envTrim(name: string): string {
  let v = (process.env[name] || "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

/** True when any Firebase credential env var is present (even if malformed). */
export function firestoreEnvPresent(): boolean {
  return !!(
    envTrim("FIREBASE_SERVICE_ACCOUNT_BASE64") ||
    (envTrim("FIREBASE_PROJECT_ID") && envTrim("FIREBASE_CLIENT_EMAIL") && envTrim("FIREBASE_PRIVATE_KEY"))
  );
}

function normalizeKey(k: string): string {
  return k.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
}

let cachedCreds: ServiceAccount | null | undefined;
let credsError: string | null = null;

/** Parse credentials from env. Returns null (and records a non-secret reason) when invalid. */
export function readServiceAccount(): ServiceAccount | null {
  if (cachedCreds !== undefined) return cachedCreds;
  credsError = null;
  const b64 = envTrim("FIREBASE_SERVICE_ACCOUNT_BASE64");
  try {
    if (b64) {
      const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, string>;
      const sa = {
        projectId: json.project_id || json.projectId || "",
        clientEmail: json.client_email || json.clientEmail || "",
        privateKey: normalizeKey(json.private_key || json.privateKey || ""),
      };
      if (!sa.projectId || !sa.clientEmail || !sa.privateKey.includes("PRIVATE KEY")) {
        throw new Error("service account JSON is missing project_id / client_email / private_key");
      }
      cachedCreds = sa;
      return sa;
    }
    const projectId = envTrim("FIREBASE_PROJECT_ID");
    const clientEmail = envTrim("FIREBASE_CLIENT_EMAIL");
    const privateKey = normalizeKey(envTrim("FIREBASE_PRIVATE_KEY"));
    if (projectId && clientEmail && privateKey) {
      if (!privateKey.includes("PRIVATE KEY")) throw new Error("FIREBASE_PRIVATE_KEY is not a PEM key");
      cachedCreds = { projectId, clientEmail, privateKey };
      return cachedCreds;
    }
    cachedCreds = null;
    return null;
  } catch (e) {
    // Never include env values in the message.
    credsError = `Invalid Firebase credentials in env: ${e instanceof Error ? e.message.slice(0, 120) : "parse error"}`;
    console.error("[firestore]", credsError);
    cachedCreds = null;
    return null;
  }
}

export function firestoreConfigError(): string | null {
  readServiceAccount();
  return credsError;
}

export function firestoreCollectionName(): string {
  const name = envTrim("TMS_FIRESTORE_COLLECTION") || DEFAULT_COLLECTION;
  if (!/^tms_[A-Za-z0-9_]{1,60}$/.test(name)) {
    throw new FirestoreStoreError(
      `TMS_FIRESTORE_COLLECTION must look like "tms_<name>" (letters, digits, _); got an invalid value`
    );
  }
  return name;
}

let appPromise: Promise<Firestore> | null = null;

async function firestore(): Promise<Firestore> {
  if (appPromise) return appPromise;
  appPromise = (async () => {
    const sa = readServiceAccount();
    if (!sa) throw new FirestoreStoreError(credsError || "Firebase credentials are not configured");
    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const APP_NAME = "tms";
    const existing = getApps().find((a: App) => a.name === APP_NAME);
    const app =
      existing ||
      initializeApp(
        {
          credential: cert({ projectId: sa.projectId, clientEmail: sa.clientEmail, privateKey: sa.privateKey }),
          projectId: sa.projectId,
        },
        APP_NAME
      );
    return getFirestore(app);
  })();
  appPromise.catch(() => {
    appPromise = null;
  });
  return appPromise;
}

function chunkId(version: number, snapshotId: string, index: number) {
  return `v${version}_${snapshotId}_c${index}`;
}

function sha256Hex(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

function toMeta(data: FirebaseFirestore.DocumentData | undefined): FirestoreMeta | null {
  if (!data || typeof data.version !== "number") return null;
  return {
    version: data.version,
    updatedAt: String(data.updatedAt || ""),
    snapshotId: String(data.snapshotId || ""),
    chunkCount: Number(data.chunkCount || 0),
    size: Number(data.size || 0),
    sha256: String(data.sha256 || ""),
  };
}

/** Current published meta, or null when the collection has no database yet. */
export async function readFirestoreMeta(): Promise<FirestoreMeta | null> {
  const db = await firestore();
  const snap = await db.collection(firestoreCollectionName()).doc("meta").get();
  return snap.exists ? toMeta(snap.data()) : null;
}

async function readChunks(meta: FirestoreMeta): Promise<Uint8Array | null> {
  const db = await firestore();
  const col = db.collection(firestoreCollectionName());
  if (meta.chunkCount <= 0) return new Uint8Array(0);
  const refs = Array.from({ length: meta.chunkCount }, (_, i) => col.doc(chunkId(meta.version, meta.snapshotId, i)));
  const docs = await db.getAll(...refs);
  const parts: Buffer[] = [];
  for (const d of docs) {
    if (!d.exists) return null; // superseded + cleaned up between our meta read and chunk read
    const data = d.get("data") as Uint8Array | Buffer | undefined;
    if (!data) return null;
    parts.push(Buffer.from(data));
  }
  const bytes = new Uint8Array(Buffer.concat(parts));
  if (bytes.length !== meta.size || sha256Hex(bytes) !== meta.sha256) {
    throw new FirestoreStoreError(
      `Firestore snapshot v${meta.version} failed integrity check (size/sha256 mismatch)`
    );
  }
  return bytes;
}

/** Per-instance cache of the last verified snapshot (bytes are immutable per version+snapshotId). */
let cache: FirestoreSnapshot | null = null;

/**
 * Load the latest database file. Returns null when nothing has been stored yet.
 * Costs 1 document read when this instance already holds the current version, otherwise 1 + chunks.
 */
export async function loadFirestoreSnapshot(): Promise<FirestoreSnapshot | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const meta = await readFirestoreMeta();
      if (!meta) return null;
      if (
        cache &&
        cache.meta.version === meta.version &&
        cache.meta.snapshotId === meta.snapshotId &&
        cache.meta.sha256 === meta.sha256
      ) {
        return { meta, bytes: cache.bytes };
      }
      const bytes = await readChunks(meta);
      if (!bytes) {
        lastErr = new FirestoreStoreError(`Chunks for v${meta.version} disappeared during read`);
        continue; // a newer version was published meanwhile — read meta again
      }
      cache = { meta, bytes };
      return { meta, bytes };
    } catch (e) {
      if (e instanceof FirestoreStoreError && !/disappeared/.test(e.message)) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new FirestoreStoreError(String(lastErr));
}

/**
 * Publish `bytes` as the next version, only if the stored version is still `expectedVersion`
 * (0 = nothing stored yet). Returns the new meta. Throws FirestoreVersionConflict otherwise.
 * `opts.initialVersion` (only when nothing is stored yet) lets a one-off import keep the old
 * version number.
 */
export async function saveFirestoreSnapshot(
  bytes: Uint8Array,
  expectedVersion: number,
  opts: { initialVersion?: number } = {}
): Promise<FirestoreMeta> {
  const db = await firestore();
  const col = db.collection(firestoreCollectionName());
  const metaRef = col.doc("meta");
  const nextVersion =
    expectedVersion === 0 && opts.initialVersion && opts.initialVersion > 0 ? opts.initialVersion : expectedVersion + 1;
  const snapshotId = randomBytes(6).toString("hex");
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkCount = Math.max(1, Math.ceil(buf.length / CHUNK_SIZE));
  const meta: FirestoreMeta = {
    version: nextVersion,
    updatedAt: new Date().toISOString(),
    snapshotId,
    chunkCount,
    size: buf.length,
    sha256: sha256Hex(buf),
  };
  const chunkRefs = Array.from({ length: chunkCount }, (_, i) => col.doc(chunkId(nextVersion, snapshotId, i)));

  // Cheap pre-check to avoid uploading chunks that can never be published.
  const pre = toMeta((await metaRef.get()).data());
  if ((pre?.version ?? 0) !== expectedVersion) {
    throw new FirestoreVersionConflict(expectedVersion, pre?.version ?? 0);
  }

  // 1) Upload chunks (new, unique doc ids; invisible until meta points at them).
  // Keep each batch well under Firestore's request size limit.
  for (let i = 0; i < chunkCount; i += 8) {
    const batch = db.batch();
    for (let j = i; j < Math.min(chunkCount, i + 8); j++) {
      batch.create(chunkRefs[j], {
        kind: "chunk",
        version: nextVersion,
        snapshotId,
        index: j,
        data: buf.subarray(j * CHUNK_SIZE, (j + 1) * CHUNK_SIZE),
        createdAt: meta.updatedAt,
      });
    }
    await batch.commit();
  }

  // 2) Publish atomically with a version check.
  try {
    await db.runTransaction(async (tx) => {
      const cur = toMeta((await tx.get(metaRef)).data());
      const curVersion = cur?.version ?? 0;
      if (curVersion !== expectedVersion) throw new FirestoreVersionConflict(expectedVersion, curVersion);
      tx.set(metaRef, meta);
    });
  } catch (e) {
    // Our chunks were never published — remove them (best effort).
    try {
      const batch = db.batch();
      for (const r of chunkRefs) batch.delete(r);
      await batch.commit();
    } catch {
      /* orphaned chunks are removed by the next successful save */
    }
    if (e instanceof FirestoreVersionConflict) throw e;
    throw new FirestoreStoreError(`Firestore publish failed: ${e instanceof Error ? e.message : String(e)}`, e);
  }

  cache = { meta, bytes: new Uint8Array(buf) };

  // 3) Delete superseded chunk docs (older versions, and orphans from failed writers).
  try {
    const old = await col.where("version", "<", nextVersion).select().get();
    const stale = old.docs.filter((d) => d.id !== "meta" && d.id.startsWith("v"));
    for (let i = 0; i < stale.length; i += 400) {
      const batch = db.batch();
      for (const d of stale.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
  } catch (e) {
    console.warn("[firestore] old chunk cleanup failed (harmless):", e instanceof Error ? e.message : e);
  }
  return meta;
}

/** Deletes every document in the configured TMS collection. Refuses the default production name. */
export async function deleteTestCollection(): Promise<number> {
  const name = firestoreCollectionName();
  if (name === DEFAULT_COLLECTION) throw new FirestoreStoreError("Refusing to delete the production collection");
  const db = await firestore();
  const docs = await db.collection(name).select().get();
  for (let i = 0; i < docs.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  cache = null;
  return docs.docs.length;
}

/** Test helper: forget the per-instance cache. */
export function clearFirestoreCache() {
  cache = null;
}
