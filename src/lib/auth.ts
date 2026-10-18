import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { cookieSecureAttribute } from "./runtime";
import type { User } from "./types";

export const SESSION_COOKIE = "tms_session";
const SESSION_DAYS = 7;

function sessionSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.TMS_SESSION_SECRET ||
    "tms-dev-session-secret-change-me"
  );
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b.toString("base64url");
}

function signPayload(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string, maxAgeSec = SESSION_DAYS * 86400): string {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSec;
  const payload = `${userId}:${exp}`;
  const body = b64url(payload);
  return `${body}.${signPayload(body)}`;
}

export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = signPayload(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [userId, expStr] = payload.split(":");
  const exp = Number(expStr);
  if (!userId || !Number.isFinite(exp)) return null;
  if (exp < Math.floor(Date.now() / 1000)) return null;
  return userId;
}

export function sessionCookieHeader(token: string, maxAgeSec = SESSION_DAYS * 86400): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${cookieSecureAttribute()}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureAttribute()}`;
}

export type PublicUser = Omit<User, "password_hash">;

export function toPublicUser(user: User): PublicUser {
  const { password_hash: _omit, ...rest } = user as User & { password_hash?: string | null };
  void _omit;
  return rest as PublicUser;
}

export async function getSessionUser(): Promise<User | null> {
  const cookieStore = cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  const userId = verifySessionToken(raw);
  if (!userId) return null;
  const db = await getDb();
  const user = (await db.prepare("SELECT * FROM users WHERE id = ?").get(userId)) as User | undefined;
  // Never carry password_hash around: this object is passed to client components (AppShell etc.)
  return user ? (toPublicUser(user) as User) : null;
}

/** Session user's stored password hash (only for verifying the current password). */
export async function getSessionPasswordHash(userId: string): Promise<string | null> {
  const db = await getDb();
  const row = (await db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId)) as
    | { password_hash: string | null }
    | undefined;
  return row?.password_hash ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}

export async function listUsers(): Promise<User[]> {
  const db = await getDb();
  const rows = (await db.prepare("SELECT * FROM users ORDER BY role, name").all()) as User[];
  return rows.map((u) => toPublicUser(u) as User);
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
