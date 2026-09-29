import { cookies } from "next/headers";
import { clearSessionCookieHeader, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { clearSeenCookieHeader, recordLogout, SEEN_COOKIE } from "@/lib/visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const store = cookies();
  const userId = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (userId) await recordLogout(userId, store.get(SEEN_COOKIE)?.value);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookieHeader());
  res.headers.append("Set-Cookie", clearSeenCookieHeader());
  return res;
}
