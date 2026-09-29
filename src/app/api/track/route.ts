import { cookies } from "next/headers";
import { jsonError, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { recordPageView, SEEN_COOKIE } from "@/lib/visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Page-view beacon (sent by AppShell on each signed-in page view).
 * Cheap on the hot path: verifies the signed session cookie only (no DB read) and bumps a counter
 * in the signed tms_seen cookie. A DB write happens only on the first view of the PKT day or when
 * the user's last write is older than ~5 minutes.
 */
export async function POST() {
  const store = cookies();
  const userId = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!userId) return jsonError("Unauthorized", 401);
  const { cookie, wrote } = await recordPageView(userId, store.get(SEEN_COOKIE)?.value);
  const res = Response.json({ ok: true, wrote });
  res.headers.set("Set-Cookie", cookie);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
