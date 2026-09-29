import { pktDateKeyNow, type TmsDb } from "./db";

/** Admin activity monitor queries (all dates are PKT calendar days). */

export const MONITOR_ROLES = ["student", "faculty", "external_examiner", "admin"] as const;
export type MonitorRole = (typeof MONITOR_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  faculty: "Faculty",
  external_examiner: "External examiner",
  admin: "Admin",
};

/** Human labels for action codes (unknown codes fall back to "snake case" → words). */
export const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  password_changed: "Password changed",
  idea_created: "Idea created",
  idea_updated: "Idea edited",
  idea_deleted: "Idea deleted",
  interest_expressed: "Interest expressed",
  interest_edited: "Interest statement edited",
  interest_withdrawn: "Interest withdrawn",
  interest_rejected: "Interest rejected",
  interest_deleted: "Interest deleted",
  student_accepted: "Interest accepted · project created",
  project_updated: "Project edited",
  project_members_changed: "Project members changed",
  project_deleted: "Project deleted",
  gec_invited: "GEC member invited",
  gec_role_changed: "GEC role changed",
  gec_accepted: "GEC invitation accepted",
  gec_removed: "GEC member removed",
  gec_finalized: "GEC finalized",
  acb_approved: "ACB approved",
  research_started: "Research stage started",
  project_completed: "Project completed",
  meeting_logged: "Meeting logged",
  meeting_updated: "Meeting edited",
  meeting_deleted: "Meeting deleted",
  milestone_created: "Milestone added",
  milestone_updated: "Milestone updated",
  milestone_deleted: "Milestone deleted",
  document_link_submitted: "Document link submitted",
  document_link_updated: "Document link edited",
  document_deleted: "Document deleted",
  form_created: "Form created",
  defence_scheduled: "Defence scheduled",
  defence_rescheduled: "Defence schedule edited",
  defence_result: "Defence result recorded",
  defence_deleted: "Defence deleted",
  e_signed: "E-signature",
  user_created: "User added",
  user_updated: "User edited",
  user_deleted: "User deleted",
  users_imported: "Users bulk-imported",
  password_reset: "Password reset (admin)",
  department_created: "Department added",
  department_renamed: "Department renamed",
  department_deleted: "Department deleted",
  form_templates_updated: "Form names updated",
  form_templates_reset: "Form names reset",
  data_cleared: "All ideas & projects cleared",
  db_reseeded: "Database re-seeded",
};

export function actionLabel(code: string): string {
  return ACTION_LABELS[code] || code.replace(/_/g, " ");
}

/** Auth/admin actions hidden from the shared dashboard feed (visible in the admin monitor). */
export const PRIVATE_ACTIONS = [
  "login",
  "logout",
  "password_changed",
  "password_reset",
  "user_created",
  "user_updated",
  "user_deleted",
  "users_imported",
  "department_created",
  "department_renamed",
  "department_deleted",
  "form_templates_updated",
  "form_templates_reset",
  "data_cleared",
  "db_reseeded",
];
export const PRIVATE_ACTIONS_SQL = PRIVATE_ACTIONS.map((a) => `'${a}'`).join(", ");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(new Date(`${v}T00:00:00+05:00`).getTime());
}

/** [start, end) UTC ISO bounds for a PKT calendar day range (inclusive dates). */
export function pktRangeIso(from: string, to: string): [string, string] {
  const start = new Date(`${from}T00:00:00+05:00`);
  const end = new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 86400000);
  return [start.toISOString(), end.toISOString()];
}

export function shiftDateKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00+05:00`).getTime() + days * 86400000;
  return pktDateKeyNow(new Date(d));
}

export type DaySummary = {
  date: string;
  students: number;
  faculty: number;
  external_examiners: number;
  admins: number;
  page_views: number;
  actions: number;
  logins: number;
  failed_logins: number;
};

export async function daySummary(db: TmsDb, date: string): Promise<DaySummary> {
  const byRole = (await db
    .prepare(
      `SELECT COALESCE(u.role, 'unknown') as role, COUNT(*) as c, COALESCE(SUM(v.page_views), 0) as pv
       FROM user_visits v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.date = ? GROUP BY COALESCE(u.role, 'unknown')`
    )
    .all(date)) as { role: string; c: number; pv: number }[];
  const count = (r: string) => Number(byRole.find((x) => x.role === r)?.c || 0);
  const pageViews = byRole.reduce((s, x) => s + Number(x.pv || 0), 0);
  const [a, b] = pktRangeIso(date, date);
  const acts = (await db
    .prepare(
      `SELECT COUNT(*) as c, SUM(CASE WHEN action = 'login' THEN 1 ELSE 0 END) as logins
       FROM activity WHERE created_at >= ? AND created_at < ?`
    )
    .get(a, b)) as { c: number; logins: number | null };
  const fails = (await db
    .prepare(`SELECT COUNT(*) as c FROM login_failures WHERE created_at >= ? AND created_at < ?`)
    .get(a, b)) as { c: number };
  return {
    date,
    students: count("student"),
    faculty: count("faculty"),
    external_examiners: count("external_examiner"),
    admins: count("admin"),
    page_views: pageViews,
    actions: Number(acts?.c || 0),
    logins: Number(acts?.logins || 0),
    failed_logins: Number(fails?.c || 0),
  };
}

export async function trend(db: TmsDb, today: string, days = 7): Promise<DaySummary[]> {
  const out: DaySummary[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(await daySummary(db, shiftDateKey(today, -i)));
  return out;
}

export type VisitRow = {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  registration_no: string | null;
  department: string | null;
  first_seen: string;
  last_seen: string;
  page_views: number;
  actions: number;
};

export async function visitedOn(db: TmsDb, date: string, role?: string | null): Promise<VisitRow[]> {
  const [a, b] = pktRangeIso(date, date);
  const params: unknown[] = [a, b, date];
  let where = `v.date = ?`;
  if (role) {
    where += ` AND u.role = ?`;
    params.push(role);
  }
  return (await db
    .prepare(
      `SELECT v.user_id, u.name, u.email, u.role, u.registration_no, u.department,
              v.first_seen, v.last_seen, v.page_views,
              (SELECT COUNT(*) FROM activity x
                WHERE x.actor_id = v.user_id AND x.created_at >= ? AND x.created_at < ?) as actions
       FROM user_visits v LEFT JOIN users u ON u.id = v.user_id
       WHERE ${where}
       ORDER BY v.last_seen DESC`
    )
    .all(...params)) as VisitRow[];
}

export type ActivityFilters = {
  from: string;
  to: string;
  role?: string | null;
  q?: string | null;
  action?: string | null;
};

export type ActivityRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  detail: string | null;
  project_id: string | null;
  target_url: string | null;
};

function activityWhere(f: ActivityFilters): { sql: string; params: unknown[] } {
  const [a, b] = pktRangeIso(f.from, f.to);
  const parts = [`a.created_at >= ?`, `a.created_at < ?`];
  const params: unknown[] = [a, b];
  if (f.role) {
    parts.push(`COALESCE(a.actor_role, u.role) = ?`);
    params.push(f.role);
  }
  if (f.action) {
    parts.push(`a.action = ?`);
    params.push(f.action);
  }
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim().toLowerCase()}%`;
    parts.push(
      `(lower(COALESCE(u.name, a.actor_name, '')) LIKE ? OR lower(COALESCE(u.email, '')) LIKE ? OR lower(COALESCE(u.registration_no, '')) LIKE ?)`
    );
    params.push(like, like, like);
  }
  return { sql: parts.join(" AND "), params };
}

export async function queryActivity(
  db: TmsDb,
  f: ActivityFilters,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ rows: ActivityRow[]; total: number }> {
  const w = activityWhere(f);
  const total = (await db
    .prepare(`SELECT COUNT(*) as c FROM activity a LEFT JOIN users u ON u.id = a.actor_id WHERE ${w.sql}`)
    .get(...w.params)) as { c: number };
  const limitSql = opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))} OFFSET ${Math.max(0, Math.floor(opts.offset || 0))}` : "";
  const rows = (await db
    .prepare(
      `SELECT a.id, a.created_at, a.actor_id,
              COALESCE(u.name, a.actor_name) as actor_name,
              u.email as actor_email,
              COALESCE(a.actor_role, u.role) as actor_role,
              a.action, a.detail, a.project_id,
              COALESCE(a.target_url, CASE WHEN a.project_id IS NOT NULL THEN '/projects/' || a.project_id END) as target_url
       FROM activity a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ${w.sql}
       ORDER BY a.created_at DESC, a.rowid DESC${limitSql}`
    )
    .all(...w.params)) as ActivityRow[];
  return { rows, total: Number(total?.c || 0) };
}

export async function actionTypes(db: TmsDb): Promise<string[]> {
  const rows = (await db.prepare(`SELECT DISTINCT action FROM activity ORDER BY action`).all()) as {
    action: string;
  }[];
  const set = new Set<string>([...Object.keys(ACTION_LABELS), ...rows.map((r) => r.action)]);
  return Array.from(set).sort((x, y) => actionLabel(x).localeCompare(actionLabel(y)));
}

export async function failedLoginsOn(db: TmsDb, date: string) {
  const [a, b] = pktRangeIso(date, date);
  return (await db
    .prepare(
      `SELECT id, email, created_at FROM login_failures
       WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 200`
    )
    .all(a, b)) as { id: string; email: string; created_at: string }[];
}

export function fmtPktTime(iso: string | null | undefined, withDate = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const opts: Intl.DateTimeFormatOptions = withDate
    ? { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
    : { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false };
  return `${d.toLocaleString("en-GB", opts)} PKT`;
}

export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
