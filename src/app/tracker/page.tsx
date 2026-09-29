import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
import {
  StudentStageTracker,
  type TrackerRow,
} from "@/components/StudentStageTracker";
import type { ProjectStage, ProjectStatus } from "@/lib/types";
import { STAGE_PIPELINE } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawRow = {
  student_id: string;
  registration_no: string | null;
  name: string;
  email: string;
  department: string | null;
  project_id: string | null;
  project_title: string | null;
  program_type: string | null;
  stage: string | null;
  status: string | null;
  progress_pct: number | null;
  supervisor_name: string | null;
  interest_count: number;
};

function stageKeyAndLabel(row: RawRow): { key: string; label: string } {
  if (row.project_id && row.stage) {
    const stage = row.stage as ProjectStage;
    const status = (row.status || "draft") as ProjectStatus;
    if (status === "completed" || stage === "complete") {
      return { key: "complete", label: "Complete" };
    }
    const pipe = STAGE_PIPELINE.find((p) => {
      if (stage === "gec_formation") return p.key === "gec";
      if (stage === "proposal") return p.key === "proposal";
      if (stage === "research") return p.key === "research";
      if (stage === "in_house") return p.key === "in_house";
      if (stage === "final") return p.key === "final";
      return false;
    });
    if (stage === "gec_formation") return { key: "gec_formation", label: "GEC formation" };
    if (pipe) return { key: stage, label: pipe.label };
    return { key: stage, label: stage.replace(/_/g, " ") };
  }
  if (Number(row.interest_count) > 0) {
    return { key: "interest", label: "Interest submitted" };
  }
  return { key: "no_project", label: "No project" };
}

export default async function TrackerPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.role !== "admin" && user.role !== "faculty") {
    redirect("/dashboard");
  }

  const db = await getDb();

  let raw: RawRow[];

  if (user.role === "admin") {
    raw = (await db
      .prepare(
        `SELECT
           u.id as student_id,
           u.registration_no,
           u.name,
           u.email,
           u.department,
           p.id as project_id,
           p.title as project_title,
           p.program_type,
           p.stage,
           p.status,
           p.progress_pct,
           sup.name as supervisor_name,
           (SELECT COUNT(*) FROM interests i WHERE i.student_id = u.id AND i.status = 'pending') as interest_count
         FROM users u
         LEFT JOIN (
           SELECT student_id, project_id FROM project_students
           UNION
           SELECT student_id, id AS project_id FROM projects
         ) map ON map.student_id = u.id
         LEFT JOIN projects p ON p.id = map.project_id
         LEFT JOIN users sup ON sup.id = p.supervisor_id
         WHERE u.role = 'student'
         ORDER BY u.registration_no, u.name`
      )
      .all()) as RawRow[];
  } else {
    raw = (await db
      .prepare(
        `SELECT DISTINCT
           u.id as student_id,
           u.registration_no,
           u.name,
           u.email,
           u.department,
           p.id as project_id,
           p.title as project_title,
           p.program_type,
           p.stage,
           p.status,
           p.progress_pct,
           sup.name as supervisor_name,
           (SELECT COUNT(*) FROM interests i
              JOIN ideas id ON id.id = i.idea_id
              WHERE i.student_id = u.id AND i.status = 'pending' AND id.faculty_id = ?) as interest_count
         FROM users u
         LEFT JOIN (
           SELECT student_id, project_id FROM project_students
           UNION
           SELECT student_id, id AS project_id FROM projects
         ) map ON map.student_id = u.id
         LEFT JOIN projects p ON p.id = map.project_id
         LEFT JOIN users sup ON sup.id = p.supervisor_id
         LEFT JOIN gec_members g ON g.project_id = p.id
         LEFT JOIN interests i2 ON i2.student_id = u.id AND i2.status = 'pending'
         LEFT JOIN ideas idea ON idea.id = i2.idea_id
         WHERE u.role = 'student'
           AND (
             p.supervisor_id = ?
             OR g.user_id = ?
             OR idea.faculty_id = ?
           )
         ORDER BY u.registration_no, u.name`
      )
      .all(user.id, user.id, user.id, user.id)) as RawRow[];
  }

  // One row per student: prefer the most advanced project if multiple
  const byStudent = new Map<string, RawRow>();
  for (const r of raw) {
    const prev = byStudent.get(r.student_id);
    if (!prev) {
      byStudent.set(r.student_id, r);
      continue;
    }
    if (!prev.project_id && r.project_id) {
      byStudent.set(r.student_id, r);
    }
  }

  const rows: TrackerRow[] = Array.from(byStudent.values()).map((r) => {
    const { key, label } = stageKeyAndLabel(r);
    return {
      student_id: r.student_id,
      registration_no: r.registration_no,
      name: r.name,
      email: r.email,
      department: r.department,
      project_id: r.project_id,
      project_title: r.project_title,
      program_type: r.program_type,
      stage: r.stage,
      status: r.status,
      progress_pct: r.progress_pct != null ? Number(r.progress_pct) : null,
      supervisor_name: r.supervisor_name,
      tracker_stage: key,
      tracker_stage_label: label,
      interest_count: Number(r.interest_count) || 0,
    };
  });

  return (
    <AppShell user={user}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Student stage tracker</h1>
          <p className="text-sm text-slate-500">
            {user.role === "admin"
              ? "One row per student — registration number, project, stage, and progress."
              : "Students on projects you supervise or sit on as GEC, plus pending interests on your ideas."}
          </p>
        </div>
        <StudentStageTracker rows={rows} />
      </div>
    </AppShell>
  );
}
