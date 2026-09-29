import { getDbMode, isDurableDb } from "@/lib/db";

export function DbBanner() {
  if (isDurableDb()) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <strong className="font-semibold">Ephemeral database.</strong> Production is missing a durable
      store URL (<code className="text-xs">TURSO_DATABASE_URL</code>). Ideas may not persist across
      serverless instances. Set Turso env vars on the Vercel project, or ensure Blob-backed SQLite is
      configured.
      <span className="block text-xs mt-1 text-amber-800">Mode: {getDbMode()}</span>
    </div>
  );
}
