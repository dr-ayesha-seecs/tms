import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import {
  logActivity,
  pktDateKeyNow,
  pruneMonitorData,
  upsertVisit,
  withDbMutation,
  type TmsDb,
} from "./db";

/**
 * Visit tracking with write throttling.
 *
 * Every DB write re-uploads the whole SQLite file to Vercel Blob, so page views are NOT written
 * one by one. Instead a short-lived signed httpOnly cookie `tms_seen` carries
 *   { u: userId, d: PKT date, f: last flush time (ms), p: page views not yet written }.
 * A page view only writes when it is the user's first view of the (PKT) day, or when the last
 * write for this user is older than VISIT_FLUSH_MS; otherwise only the cookie counter moves.
 */
export const SEEN_COOKIE = "tms_seen";
export const VISIT_FLUSH_MS = 5 * 60 * 1000;
const SEEN_MAX_AGE_SEC = 36 * 3600;

type Seen = { u: string; d: string; f: number; p: number };

function secret(): string {
  return (
    (process.env.SESSION_SECRET || process.env.TMS_SESSION_SECRET || "tms-dev-session-secret-change-me") +
    ":seen"
  );
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function encodeSeen(s: Seen): string {
  const body = Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSeen(raw: string | undefined | null): Seen | null {
  if (!raw || !raw.includes(".")) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(sign(body));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Seen;
    if (!v || typeof v.u !== "string" || typeof v.d !== "string") return null;
    return { u: v.u, d: v.d, f: Number(v.f) || 0, p: Math.max(0, Number(v.p) || 0) };
  } catch {
    return null;
  }
}

function secureAttr(): string {
  return process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function seenCookieHeader(s: Seen): string {
  return `${SEEN_COOKIE}=${encodeSeen(s)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SEEN_MAX_AGE_SEC}${secureAttr()}`;
}

export function clearSeenCookieHeader(): string {
  return `${SEEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttr()}`;
}

/** Decide whether this page view must be written now. Pure — easy to reason about/test. */
export function planPageView(
  userId: string,
  seen: Seen | null,
  nowMs = Date.now()
): { flush: boolean; views: number; firstOfDay: boolean } {
  const today = pktDateKeyNow(new Date(nowMs));
  if (!seen || seen.u !== userId || seen.d !== today) {
    return { flush: true, views: 1, firstOfDay: true };
  }
  const views = seen.p + 1;
  if (nowMs - seen.f >= VISIT_FLUSH_MS) return { flush: true, views, firstOfDay: false };
  return { flush: false, views, firstOfDay: false };
}

const MIN_INSTANCE_GAP_MS = 60 * 1000;
const recentFlush = new Map<string, { d: string; at: number }>();

/**
 * Record one page view for a signed-in user. Returns the Set-Cookie value and whether a DB write happened.
 */
export async function recordPageView(
  userId: string,
  rawSeen: string | undefined | null
): Promise<{ cookie: string; wrote: boolean }> {
  const nowMs = Date.now();
  const today = pktDateKeyNow(new Date(nowMs));
  const seen = decodeSeen(rawSeen);
  const plan = planPageView(userId, seen, nowMs);
  // Per-instance guard: even if the cookie is dropped/tampered, write at most once a minute per user
  // on this instance (the first-of-day row already exists if we wrote in the last minute today).
  const recent = recentFlush.get(userId);
  if (plan.flush && recent && recent.d === today && nowMs - recent.at < MIN_INSTANCE_GAP_MS) {
    return {
      cookie: seenCookieHeader({ u: userId, d: today, f: recent.at, p: plan.views }),
      wrote: false,
    };
  }
  if (!plan.flush) {
    return { cookie: seenCookieHeader({ u: userId, d: today, f: seen!.f, p: plan.views }), wrote: false };
  }
  try {
    const ok = await withDbMutation(async (db) => {
      const exists = await db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId);
      if (!exists) return false;
      await db.transaction(async () => {
        await upsertVisit(db, userId, plan.views, new Date(nowMs));
        await pruneMonitorData(db);
      });
      return true;
    });
    recentFlush.set(userId, { d: today, at: nowMs });
    if (recentFlush.size > 5000) recentFlush.clear();
    return { cookie: seenCookieHeader({ u: userId, d: today, f: nowMs, p: 0 }), wrote: ok };
  } catch (e) {
    console.warn("[visits] page-view flush failed:", e instanceof Error ? e.message : e);
    // Keep the pending count; retry in ~1 minute instead of on every view.
    const retryAt = nowMs - VISIT_FLUSH_MS + 60 * 1000;
    return {
      cookie: seenCookieHeader({ u: userId, d: today, f: retryAt, p: plan.views }),
      wrote: false,
    };
  }
}

/** Login: activity row + today's visit row in ONE write. Never throws (login must not fail on logging). */
export async function recordLogin(user: { id: string; name: string; role: string; email: string }): Promise<string> {
  const nowMs = Date.now();
  try {
    await withDbMutation(async (db) => {
      await db.transaction(async () => {
        await logActivity(db, {
          actor_id: user.id,
          actor_role: user.role,
          actor_name: user.name,
          action: "login",
          detail: `Signed in (${user.email})`,
        });
        await upsertVisit(db, user.id, 0, new Date(nowMs));
        await pruneMonitorData(db);
      });
    });
  } catch (e) {
    console.warn("[visits] login logging failed:", e instanceof Error ? e.message : e);
  }
  recentFlush.set(user.id, { d: pktDateKeyNow(new Date(nowMs)), at: nowMs });
  return seenCookieHeader({ u: user.id, d: pktDateKeyNow(new Date(nowMs)), f: nowMs, p: 0 });
}

/** Logout: activity row + flush any pending page views in ONE write. Never throws. */
export async function recordLogout(userId: string, rawSeen: string | undefined | null): Promise<void> {
  const seen = decodeSeen(rawSeen);
  const pending = seen && seen.u === userId && seen.d === pktDateKeyNow() ? seen.p : 0;
  try {
    await withDbMutation(async (db) => {
      const u = (await db.prepare(`SELECT id, name, role FROM users WHERE id = ?`).get(userId)) as
        | { id: string; name: string; role: string }
        | undefined;
      if (!u) return;
      await db.transaction(async () => {
        await logActivity(db, {
          actor_id: u.id,
          actor_role: u.role,
          actor_name: u.name,
          action: "logout",
          detail: "Signed out",
        });
        if (pending > 0) await upsertVisit(db, u.id, pending);
      });
    });
  } catch (e) {
    console.warn("[visits] logout logging failed:", e instanceof Error ? e.message : e);
  }
}

/** Soft cap so a brute-force burst cannot turn into hundreds of whole-file Blob writes. */
const FAILED_LOGIN_CAP_PER_10_MIN = 30;

/** Failed login: stores the (lower-cased) email and time only — never the password. Never throws. */
export async function recordFailedLogin(email: string): Promise<void> {
  const clean = String(email || "").trim().toLowerCase().slice(0, 200) || "(blank)";
  try {
    await withDbMutation(async (db: TmsDb) => {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const recent = (await db
        .prepare(`SELECT COUNT(*) as c FROM login_failures WHERE created_at >= ?`)
        .get(since)) as { c: number };
      if (Number(recent?.c || 0) >= FAILED_LOGIN_CAP_PER_10_MIN) return;
      await db
        .prepare(`INSERT INTO login_failures (id, email, created_at) VALUES (?, ?, ?)`)
        .run(randomUUID(), clean, new Date().toISOString());
    });
  } catch (e) {
    console.warn("[visits] failed-login logging failed:", e instanceof Error ? e.message : e);
  }
}
