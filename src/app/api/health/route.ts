import { getStorageLabel } from "@/lib/db";
import { firestoreConfigError, readFirestoreMeta } from "@/lib/firestore-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let deepCache: { at: number; value: Record<string, unknown> } | null = null;

/**
 * Public liveness check — reveals nothing about data or secrets.
 * `storage` is "firestore" when Firebase credentials are configured, "temporary" when the app is
 * running on a non-persistent copy. `?deep=1` additionally checks that Firestore is reachable
 * (cached 60s per instance to keep document reads low).
 */
export async function GET(req: Request) {
  const storage = getStorageLabel();
  const body: Record<string, unknown> = { ok: true, storage };
  if (storage === "firestore") {
    const cfgErr = firestoreConfigError();
    body.credentials = cfgErr ? "invalid" : "ok";
    const deep = new URL(req.url).searchParams.get("deep") === "1";
    if (deep && !cfgErr) {
      if (deepCache && Date.now() - deepCache.at < 60_000) {
        Object.assign(body, deepCache.value);
      } else {
        let value: Record<string, unknown>;
        try {
          const meta = await readFirestoreMeta();
          value = { firestore: "reachable", hasData: !!meta, dbVersion: meta?.version ?? 0 };
        } catch {
          value = { firestore: "error" };
        }
        deepCache = { at: Date.now(), value };
        Object.assign(body, value);
      }
    }
  }
  return Response.json(body);
}
