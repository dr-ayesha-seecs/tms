import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FormsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const db = await getDb();

  const forms = await db
    .prepare(
      `SELECT f.*, p.title as project_title, p.program_type,
        COALESCE(ft.display_name, f.form_type) as display_name,
        (SELECT COUNT(*) FROM signatures s WHERE s.target_type = 'form' AND s.target_id = f.id) as sig_count,
        EXISTS(SELECT 1 FROM signatures s WHERE s.target_type = 'form' AND s.target_id = f.id AND s.user_id = ?) as i_signed
       FROM forms f
       JOIN projects p ON p.id = f.project_id
       LEFT JOIN form_templates ft ON ft.program_type = p.program_type AND ft.code = f.form_type
       LEFT JOIN gec_members g ON g.project_id = f.project_id
       WHERE ? = 'admin' OR p.supervisor_id = ? OR p.student_id = ? OR g.user_id = ?
       GROUP BY f.id
       ORDER BY f.created_at DESC`
    )
    .all(user.id, user.role, user.id, user.id, user.id) as {
    id: string;
    project_id: string;
    form_type: string;
    display_name: string;
    program_type: string;
    status: string;
    project_title: string;
    sig_count: number;
    i_signed: number;
    created_at: string;
  }[];

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Forms registry</h1>
          <p className="text-sm text-slate-500">
            Form labels are configured per FYP / MS Thesis track in Admin.
            Open a project to create or e-sign forms.
          </p>
        </div>
        <div className="grid gap-3">
          {forms.map((f) => (
            <Link key={f.id} href={`/projects/${f.project_id}`} className="card p-4 hover:border-teal-300 block">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="font-semibold text-navy">{f.display_name}</div>
                  <div className="text-sm text-slate-600">{f.project_title}</div>
                  <div className="text-[11px] text-slate-400">{f.program_type === "FYP" ? "FYP" : "MS Thesis"} · {f.form_type}</div>
                  <div className="text-xs text-slate-400 mt-1">{formatDate(f.created_at)} · {f.sig_count} signature(s)</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={f.status} />
                  {f.i_signed ? <span className="badge-success">You signed</span> : f.status === "pending_signatures" ? <span className="badge-warning">You may need to sign</span> : null}
                </div>
              </div>
            </Link>
          ))}
          {!forms.length && <div className="card p-6 text-sm text-slate-500">No forms in your scope yet.</div>}
        </div>
      </div>
    </AppShell>
  );
}
