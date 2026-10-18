/**
 * Checks the Turso client path against a local libSQL file:
 * row mapping (no toJSON), a committed write inside transaction(), and a rolled-back write.
 *
 *   npx tsx scripts/check-turso-transaction.ts
 *
 * Uses file:/tmp so it does not touch data/tms.sqlite or a remote database.
 */
import fs from "fs";
import { randomUUID } from "crypto";

const file = "/tmp/tms-turso-tx-check.db";
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });

process.env.TURSO_DATABASE_URL = `file:${file}`;
process.env.TURSO_AUTH_TOKEN = "local";
delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

async function main() {
  const { getDb, getStorageLabel } = await import("../src/lib/db");
  if (getStorageLabel() !== "turso") {
    throw new Error(`expected storage turso, got ${getStorageLabel()}`);
  }
  const db = await getDb();
  const probe = (await db.prepare("SELECT COUNT(*) as c FROM users").get()) as { c: number } | undefined;
  if (!probe || typeof probe.c !== "number") {
    throw new Error("row mapping failed: users count did not come back as { c: number }");
  }

  const committed = randomUUID();
  await db.transaction(async () => {
    await db.transaction(async () => {
      await db
        .prepare("INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)")
        .run(committed, `Tx ${committed}`, new Date().toISOString());
    });
  });
  const row = (await db.prepare("SELECT name FROM departments WHERE id = ?").get(committed)) as
    | { name: string }
    | undefined;
  if (!row || row.name !== `Tx ${committed}`) {
    throw new Error("committed transaction row was not visible after commit");
  }

  const rolled = randomUUID();
  let threw = false;
  try {
    await db.transaction(async () => {
      await db
        .prepare("INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)")
        .run(rolled, `Rollback ${rolled}`, new Date().toISOString());
      throw new Error("force rollback");
    });
  } catch (e) {
    threw = e instanceof Error && e.message === "force rollback";
  }
  if (!threw) throw new Error("rollback transaction did not throw");
  const ghost = await db.prepare("SELECT id FROM departments WHERE id = ?").get(rolled);
  if (ghost) throw new Error("rolled-back row was still visible");

  console.log(
    JSON.stringify({
      ok: true,
      storage: "turso",
      url: `file:${file}`,
      users: probe.c,
      committed: true,
      rolledBack: true,
    })
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
