import { getDb } from "@/lib/db";
import {
  createSessionToken,
  sessionCookieHeader,
  jsonError,
  toPublicUser,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/passwords";
import type { User } from "@/lib/types";
import { recordFailedLogin, recordLogin } from "@/lib/visits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return jsonError("Email and password are required");

  const db = await getDb();
  const user = (await db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email)) as
    | User
    | undefined;
  if (!user) {
    await recordFailedLogin(email);
    return jsonError("Invalid email or password", 401);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await recordFailedLogin(email);
    return jsonError("Invalid email or password", 401);
  }

  // Login activity + today's visit row (one write; never blocks a successful login)
  const seenCookie = await recordLogin(user);

  const token = createSessionToken(user.id);
  const res = Response.json({
    user: toPublicUser(user),
    must_change_password: Number(user.must_change_password) === 1,
  });
  res.headers.append("Set-Cookie", sessionCookieHeader(token));
  res.headers.append("Set-Cookie", seenCookie);
  return res;
}
