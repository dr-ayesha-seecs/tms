import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const db = await getDb();

  let projects: {
    id: string;
    title: string;
    status: string;
    stage: string;
    progress_pct: number;
    student_name: string;
    student_registration_no: string | null;
    supervisor_name: string;
    domain: string;
    program_type: string;
  }[];

  if (user.role === "admin") {
    projects = await db
      .prepare(
        `SELECT p.*, s.name as student_name, s.registration_no as student_registration_no, f.name as supervisor_name
         FROM projects p JOIN users s ON s.id = p.student_id JOIN users f ON f.id = p.supervisor_id
         ORDER BY p.updated_at DESC`
      )
      .all() as typeof projects;
  } else if (user.role === "student") {
    projects = await db
      .prepare(
        `SELECT DISTINCT p.*, s.name as student_name, s.registration_no as student_registration_no, f.name as supervisor_name
         FROM projects p
         JOIN users s ON s.id = p.student_id
         JOIN users f ON f.id = p.supervisor_id
         LEFT JOIN project_students ps ON ps.project_id = p.id
         WHERE p.student_id = ? OR ps.student_id = ?
         ORDER BY p.updated_at DESC`
      )
      .all(user.id, user.id) as typeof projects;
  } else {
    projects = await db
      .prepare(
        `SELECT DISTINCT p.*, s.name as student_name, s.registration_no as student_registration_no, f.name as supervisor_name
         FROM projects p JOIN users s ON s.id = p.student_id JOIN users f ON f.id = p.supervisor_id
         LEFT JOIN gec_members g ON g.project_id = p.id
         WHERE p.supervisor_id = ? OR g.user_id = ?
         ORDER BY p.updated_at DESC`
      )
      .all(user.id, user.id) as typeof projects;
  }

  const membersByProject = new Map<string, { name: string; registration_no: string | null }[]>();
  if (projects.length) {
    const ids = projects.map((p) => p.id);
    const placeholders = ids.map(() => "?").join(",");
    const memberRows = (await db
      .prepare(
        `SELECT ps.project_id, u.name, u.registration_no
         FROM project_students ps JOIN users u ON u.id = ps.student_id
         WHERE ps.project_id IN (${placeholders})
         ORDER BY u.registration_no, u.name`
      )
      .all(...ids)) as { project_id: string; name: string; registration_no: string | null }[];
    for (const r of memberRows) {
      const list = membersByProject.get(r.project_id) || [];
      list.push({ name: r.name, registration_no: r.registration_no });
      membersByProject.set(r.project_id, list);
    }
  }

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Projects</h1>
          <p className="text-sm text-slate-500">Active thesis projects linked to ideas and GEC.</p>
        </div>
        <div className="grid gap-4">
          {projects.length === 0 && (
            <div className="card p-6 text-sm text-slate-500">
              No projects yet. Accept a student interest from an Idea to create one.
            </div>
          )}
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card p-5 hover:border-teal-300 block">
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="font-semibold text-navy">{p.title}</h2>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={p.status} />
                  <span className="badge-info">{p.program_type === "FYP" ? "FYP" : "MS Thesis"}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                <span>
                  Students:{" "}
                  {(membersByProject.get(p.id)?.length
                    ? membersByProject.get(p.id)!
                    : [{ name: p.student_name, registration_no: p.student_registration_no }]
                  )
                    .map((m) => `${m.name}${m.registration_no ? ` (${m.registration_no})` : ""}`)
                    .join(", ")}
                </span>
                <span>Supervisor: {p.supervisor_name}</span>
                <span>{p.domain}</span>
                <span className="capitalize">Stage: {p.stage.replace(/_/g, " ")}</span>
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Progress</span>
                  <span>{p.progress_pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-teal-600" style={{ width: `${p.progress_pct}%` }} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
