import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSessionUser, listUsers } from "@/lib/auth";
import { getDb, getFormTemplates, formDisplayName } from "@/lib/db";
import { getProject, listGec, getSignatures, listProjectStudents } from "@/lib/api-helpers";
import { AppShell } from "@/components/AppShell";
import { ProjectHub } from "@/components/ProjectHub";
import type { ProgramType } from "@/lib/types";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const project = await getProject(params.id);
  const students = project ? await listProjectStudents(project.id) : [];
  if (!project) notFound();
  const db = await getDb();
  const program = (project.program_type || "MS_THESIS") as ProgramType;

  const gec = await listGec(params.id);
  const meetings = await db
    .prepare(`SELECT * FROM meetings WHERE project_id = ? ORDER BY meeting_date DESC`)
    .all(params.id);
  const milestones = await db
    .prepare(`SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date`)
    .all(params.id);
  const defences = await db
    .prepare(`SELECT * FROM defences WHERE project_id = ? ORDER BY created_at`)
    .all(params.id);
  const documentRows = (await db
    .prepare(
      `SELECT d.*, u.name as uploader_name FROM documents d
         JOIN users u ON u.id = d.uploaded_by WHERE d.project_id = ? ORDER BY d.created_at DESC`
    )
    .all(params.id)) as { id: string }[];
  const documents = await Promise.all(
    documentRows.map(async (d) => ({ ...d, signatures: await getSignatures("document", d.id) }))
  );
  const formRows = (await db
    .prepare(`SELECT * FROM forms WHERE project_id = ? ORDER BY created_at DESC`)
    .all(params.id)) as { id: string; form_type: string }[];
  const forms = await Promise.all(
    formRows.map(async (f) => ({
      ...f,
      display_name: await formDisplayName(db, program, f.form_type),
      signatures: await getSignatures("form", f.id),
    }))
  );
  const activity = await db
    .prepare(
      `SELECT a.*, COALESCE(u.name, a.actor_name) as actor_name FROM activity a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT 40`
    )
    .all(params.id);

  const facultyPool = (await listUsers()).filter(
    (u) => u.role === "faculty" || u.role === "external_examiner"
  );
  const formTemplates = await getFormTemplates(db, program, true);

  return (
    <AppShell user={user}>
      <div className="mb-4">
        <Link href="/projects" className="text-sm text-teal-700 hover:underline">
          ← Projects
        </Link>
      </div>
      <ProjectHub
        user={user}
        project={project}
        students={students as never}
        gec={gec as never}
        meetings={meetings as never}
        milestones={milestones as never}
        defences={defences as never}
        documents={documents as never}
        forms={forms as never}
        activity={activity as never}
        facultyPool={facultyPool}
        formTemplates={formTemplates as never}
        initialTab={searchParams?.tab}
      />
    </AppShell>
  );
}
