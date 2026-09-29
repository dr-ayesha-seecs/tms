import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { computeNotifications } from "@/lib/notifications";
import { NotificationsList } from "@/components/NotificationsList";
import { PRIVATE_ACTIONS_SQL, actionLabel } from "@/lib/activity-monitor";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const db = await getDb();

  const ideaCount = (await db.prepare("SELECT COUNT(*) as c FROM ideas").get() as { c: number }).c;
  const projectCount = (await db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c;
  const openIdeas = (await db.prepare("SELECT COUNT(*) as c FROM ideas WHERE status = 'open'").get() as { c: number }).c;

  let myProjects: unknown[] = [];
  let pendingInterests = 0;
  let pendingSigs = 0;

  if (user.role === "student") {
    myProjects = await db
      .prepare(
        `SELECT DISTINCT p.*, f.name as supervisor_name FROM projects p
         JOIN users f ON f.id = p.supervisor_id
         LEFT JOIN project_students ps ON ps.project_id = p.id
         WHERE p.student_id = ? OR ps.student_id = ?`
      )
      .all(user.id, user.id);
  } else if (user.role === "faculty" || user.role === "external_examiner") {
    myProjects = await db
      .prepare(
        `SELECT DISTINCT p.*, s.name as student_name FROM projects p
         LEFT JOIN gec_members g ON g.project_id = p.id
         JOIN users s ON s.id = p.student_id
         WHERE p.supervisor_id = ? OR g.user_id = ?`
      )
      .all(user.id, user.id);
    pendingInterests = (
      await db
        .prepare(
          `SELECT COUNT(*) as c FROM interests x
           JOIN ideas i ON i.id = x.idea_id
           WHERE i.faculty_id = ? AND x.status = 'pending'`
        )
        .get(user.id) as { c: number }
    ).c;
  } else {
    myProjects = await db
      .prepare(
        `SELECT p.*, s.name as student_name, f.name as supervisor_name FROM projects p
         JOIN users s ON s.id = p.student_id JOIN users f ON f.id = p.supervisor_id`
      )
      .all();
  }

  pendingSigs = (
    await db
      .prepare(
        `SELECT COUNT(*) as c FROM forms f
         JOIN gec_members g ON g.project_id = f.project_id
         WHERE g.user_id = ? AND f.status = 'pending_signatures'
           AND NOT EXISTS (
             SELECT 1 FROM signatures s WHERE s.target_type = 'form' AND s.target_id = f.id AND s.user_id = ?
           )`
      )
      .get(user.id, user.id) as { c: number }
  ).c;

  const notifications = await computeNotifications(user);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const activity = await db
    .prepare(
      `SELECT a.*, COALESCE(u.name, a.actor_name) as actor_name FROM activity a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.action NOT IN (${PRIVATE_ACTIONS_SQL})
       ORDER BY a.created_at DESC LIMIT 12`
    )
    .all() as { id: string; action: string; detail: string | null; actor_name?: string; created_at: string; project_id: string | null }[];

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Welcome, {user.name.split(" ")[0]}</h1>
          <p className="text-slate-500 text-sm">
            Role-aware overview · {user.title} {user.department ? `· ${user.department}` : ""}
          </p>
        </div>

        <section className="card p-5" data-testid="dashboard-notifications">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-navy">
              Notifications &amp; reminders
              {unreadCount > 0 && (
                <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-xs text-white">{unreadCount} new</span>
              )}
            </h2>
            <Link href="/notifications" className="text-sm text-teal-700 hover:underline">
              View all
            </Link>
          </div>
          <NotificationsList initial={notifications} limit={6} compact />
        </section>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Ideas" value={ideaCount} hint={`${openIdeas} open`} />
          <Stat label="Projects" value={projectCount} hint="system-wide" />
          <Stat label="My / related projects" value={(myProjects as unknown[]).length} hint="for you" />
          <Stat
            label={user.role === "faculty" ? "Pending interests" : "Forms awaiting you"}
            value={user.role === "faculty" ? pendingInterests : pendingSigs}
            hint="action needed"
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <section className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-navy">Your projects</h2>
              <Link href="/projects" className="text-sm text-teal-700 hover:underline">
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {(myProjects as { id: string; title: string; status: string; stage: string; student_name?: string; supervisor_name?: string }[]).length === 0 && (
                <p className="text-sm text-slate-500">No projects yet. Start from Ideas.</p>
              )}
              {(myProjects as { id: string; title: string; status: string; stage: string; student_name?: string; supervisor_name?: string }[]).map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="block rounded-lg border border-slate-100 hover:border-teal-300 px-3 py-3">
                  <div className="font-medium text-sm text-navy line-clamp-1">{p.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 items-center">
                    <StatusBadge status={p.status} />
                    <span className="text-xs text-slate-500 capitalize">{p.stage.replace("_", " ")}</span>
                    {p.student_name && <span className="text-xs text-slate-400">Student: {p.student_name}</span>}
                    {p.supervisor_name && <span className="text-xs text-slate-400">Supervisor: {p.supervisor_name}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold text-navy mb-4">Recent activity</h2>
            <ul className="space-y-3">
              {activity.map((a) => (
                <li key={a.id} className="text-sm border-b border-slate-50 pb-2">
                  <div className="font-medium text-slate-800">{actionLabel(a.action)}</div>
                  <div className="text-xs text-slate-500">
                    {a.actor_name || "System"} · {formatDate(a.created_at)}
                  </div>
                  {a.detail && <div className="text-xs text-slate-600 mt-0.5">{a.detail}</div>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="card p-5 bg-gradient-to-r from-slate-50 to-teal-50">
          <h2 className="font-semibold text-navy mb-2">Quick demo path</h2>
          <ol className="text-sm text-slate-700 list-decimal list-inside space-y-1">
            <li>Faculty (Dr. Sara) — review Fatima&apos;s interest on Ideas</li>
            <li>Student (Hassan) — show interest in the open IoT idea</li>
            <li>Faculty (Dr. Ahmed) — open Ali&apos;s project; GEC e-sign pending docs; run defences</li>
            <li>External examiner — sign pending forms/documents</li>
          </ol>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-3xl font-bold text-navy mt-1">{value}</div>
      <div className="text-xs text-teal-700 mt-1">{hint}</div>
    </div>
  );
}
