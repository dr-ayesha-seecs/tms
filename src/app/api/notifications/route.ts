import { getSessionUser, jsonError } from "@/lib/auth";
import { computeNotifications, markNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const list = await computeNotifications(user);
  const unread = list.filter((n) => !n.read).length;
  const countOnly = new URL(req.url).searchParams.get("count") === "1";
  return Response.json(countOnly ? { unread } : { unread, notifications: list });
}

/** Body: { action: "read" | "dismiss" | "unread" | "read_all", keys?: string[] } */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  let keys: string[] = Array.isArray(body.keys) ? body.keys : [];
  if (action === "read_all") {
    keys = (await computeNotifications(user)).filter((n) => !n.read).map((n) => n.key);
    await markNotifications(user.id, keys, "read");
  } else if (action === "read" || action === "dismiss" || action === "unread") {
    if (!keys.length) return jsonError("keys required");
    await markNotifications(user.id, keys, action);
  } else {
    return jsonError("Invalid action");
  }
  const list = await computeNotifications(user);
  return Response.json({ ok: true, unread: list.filter((n) => !n.read).length });
}
