/**
 * Maintenance tool for the TMS database stored in Firestore.
 * Credentials and collection come from env (FIREBASE_SERVICE_ACCOUNT_BASE64, TMS_FIRESTORE_COLLECTION).
 *
 *   npx tsx scripts/firestore-db.ts meta
 *   npx tsx scripts/firestore-db.ts download backup.sqlite
 *   npx tsx scripts/firestore-db.ts upload tms.sqlite [--initial-version N]   # only into an EMPTY collection
 *   npx tsx scripts/firestore-db.ts upload tms.sqlite --expected N            # replace current version N
 *   npx tsx scripts/firestore-db.ts delete-test-collection                    # refuses "tms_db"
 */
import fs from "fs";
import { createHash } from "crypto";
import {
  clearFirestoreCache,
  deleteTestCollection,
  firestoreCollectionName,
  loadFirestoreSnapshot,
  readFirestoreMeta,
  saveFirestoreSnapshot,
} from "../src/lib/firestore-store";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [cmd, file] = process.argv.slice(2);
  const col = firestoreCollectionName();
  console.log(`collection: ${col}`);
  if (cmd === "meta") {
    console.log(await readFirestoreMeta());
  } else if (cmd === "download" && file) {
    const snap = await loadFirestoreSnapshot();
    if (!snap) throw new Error("No database stored in this collection");
    fs.writeFileSync(file, Buffer.from(snap.bytes));
    console.log(`wrote ${file}: ${snap.bytes.length} bytes, v${snap.meta.version}, sha256 ${snap.meta.sha256}`);
  } else if (cmd === "upload" && file) {
    const bytes = new Uint8Array(fs.readFileSync(file));
    if (Buffer.from(bytes.subarray(0, 16)).toString("latin1") !== "SQLite format 3\u0000") {
      throw new Error("Not a SQLite database file");
    }
    const cur = await readFirestoreMeta();
    const expectedArg = arg("--expected");
    const expected = expectedArg !== undefined ? Number(expectedArg) : 0;
    if (cur && expectedArg === undefined) {
      throw new Error(`Collection already holds v${cur.version}; pass --expected ${cur.version} to replace it`);
    }
    const initialVersion = arg("--initial-version") ? Number(arg("--initial-version")) : undefined;
    const meta = await saveFirestoreSnapshot(bytes, expected, { initialVersion });
    console.log("published", meta);
    clearFirestoreCache();
    const back = await loadFirestoreSnapshot();
    const sha = createHash("sha256").update(bytes).digest("hex");
    const ok = !!back && Buffer.from(back.bytes).equals(Buffer.from(bytes)) && back.meta.sha256 === sha;
    console.log(`read-back: ${ok ? "OK" : "MISMATCH"} (sha256 ${back?.meta.sha256})`);
    if (!ok) process.exitCode = 2;
  } else if (cmd === "delete-test-collection") {
    console.log(`deleted ${await deleteTestCollection()} docs`);
  } else {
    console.log("usage: meta | download <file> | upload <file> [--initial-version N | --expected N] | delete-test-collection");
    process.exitCode = 1;
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
