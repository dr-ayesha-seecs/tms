import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, pktDateKeyNow } from "@/lib/db";
import {
  actionLabel,
  csvCell,
  fmtPktTime,
  isDateKey,
  MONITOR_ROLES,
  queryActivity,
  ROLE_LABELS,
} from "@/lib/activity-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV export of the filtered activity log (admin only). Same filters as /admin/activity. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);

  const sp = new URL(req.url).searchParams;
  const today = pktDateKeyNow();
  let from = sp.get("from") || "";
  let to = sp.get("to") || "";
  if (!isDateKey(from)) from = today;
  if (!isDateKey(to)) to = from > today ? from : today;
  if (from > to) [from, to] = [to, from];
  const roleRaw = sp.get("role") || "";
  const role = (MONITOR_ROLES as readonly string[]).includes(roleRaw) ? roleRaw : null;
  const q = (sp.get("q") || "").slice(0, 100) || null;
  const action = (sp.get("action") || "").slice(0, 60) || null;

  const db = await getDb();
  const { rows } = await queryActivity(db, { from, to, role, q, action }, { limit: 50000 });
  const origin = new URL(req.url).origin;
  const lines = [
    ["Time (PKT)", "User", "Email", "Role", "Action", "Action code", "Details", "Link"].join(","),
    ...rows.map((r) =>
      [
        fmtPktTime(r.created_at, true),
        r.actor_name || "System",
        r.actor_email || "",
        r.actor_role ? ROLE_LABELS[r.actor_role] || r.actor_role : "",
        actionLabel(r.action),
        r.action,
        r.detail || "",
        r.target_url && r.target_url.startsWith("/") ? origin + r.target_url : "",
      ]
        .map(csvCell)
        .join(",")
    ),
  ];
  const name = `tms-activity_${from}${to !== from ? `_to_${to}` : ""}.csv`;
  return new Response("\uFEFF" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
