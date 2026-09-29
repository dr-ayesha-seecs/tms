import { getDb, logActivity, formDisplayName, type TmsDb } from "./db";
import type { FormType, GecRole, Project, ProgramType } from "./types";
import { FORM_CODES } from "./form-templates";
import { countFilledPlaces, recomputeSlotsFilled } from "./idea-capacity";

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDb();
  return (await db
    .prepare(
      `SELECT p.*, s.name as student_name, s.registration_no as student_registration_no, f.name as supervisor_name
       FROM projects p
       JOIN users s ON s.id = p.student_id
       JOIN users f ON f.id = p.supervisor_id
       WHERE p.id = ?`
    )
    .get(id)) as Project | undefined;
}

export async function listGec(projectId: string) {
  const db = await getDb();
  return await db
    .prepare(
      `SELECT g.*, u.name as user_name, u.email as user_email, u.title as user_title
       FROM gec_members g JOIN users u ON u.id = g.user_id
       WHERE g.project_id = ? ORDER BY
         CASE g.gec_role
           WHEN 'supervisor' THEN 1
           WHEN 'co_supervisor' THEN 2
           WHEN 'internal_examiner' THEN 3
           WHEN 'external_examiner' THEN 4
           ELSE 5 END`
    )
    .all(projectId);
}

export async function formFullySigned(formId: string, projectId: string): Promise<boolean> {
  const db = await getDb();
  const gecCount = (
    (await db.prepare("SELECT COUNT(*) as c FROM gec_members WHERE project_id = ?").get(projectId)) as {
      c: number;
    }
  ).c;
  const sigCount = (
    (await db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) as c FROM signatures
         WHERE target_type = 'form' AND target_id = ?`
      )
      .get(formId)) as { c: number }
  ).c;
  return Number(gecCount) > 0 && Number(sigCount) >= Number(gecCount);
}

export async function hasSignedForm(projectId: string, formType: FormType): Promise<boolean> {
  const db = await getDb();
  const form = (await db
    .prepare(
      `SELECT id, status FROM forms WHERE project_id = ? AND form_type = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(projectId, formType)) as { id: string; status: string } | undefined;
  if (!form) return false;
  if (form.status === "signed" || form.status === "approved") return true;
  return formFullySigned(form.id, projectId);
}

export async function th1Complete(projectId: string): Promise<boolean> {
  return hasSignedForm(projectId, FORM_CODES.GEC_FORMATION);
}

export async function getSignatures(targetType: string, targetId: string) {
  const db = await getDb();
  return await db
    .prepare(
      `SELECT s.*, u.name as user_name FROM signatures s
       JOIN users u ON u.id = s.user_id
       WHERE s.target_type = ? AND s.target_id = ?
       ORDER BY s.signed_at`
    )
    .all(targetType, targetId);
}

export function roleLabelForGec(role: GecRole): string {
  switch (role) {
    case "supervisor":
      return "Supervisor";
    case "co_supervisor":
      return "Co-Supervisor";
    case "internal_examiner":
      return "Internal Examiner";
    case "external_examiner":
      return "External Examiner";
    default:
      return role;
  }
}

export async function resolveFormLabel(program: ProgramType, code: string): Promise<string> {
  return formDisplayName(await getDb(), program, code);
}


export async function listProjectStudents(projectId: string) {
  const db = await getDb();
  return (await db
    .prepare(
      `SELECT ps.project_id, ps.student_id, ps.added_at,
              u.name, u.email, u.registration_no
       FROM project_students ps
       JOIN users u ON u.id = ps.student_id
       WHERE ps.project_id = ?
       ORDER BY u.registration_no, u.name`
    )
    .all(projectId)) as {
    project_id: string;
    student_id: string;
    added_at: string;
    name: string;
    email: string;
    registration_no: string | null;
  }[];
}

export async function isProjectStudent(projectId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .prepare(`SELECT 1 as ok FROM project_students WHERE project_id = ? AND student_id = ?`)
    .get(projectId, userId);
  if (row) return true;
  // Backward compat: legacy projects.student_id
  const p = await db.prepare(`SELECT student_id FROM projects WHERE id = ?`).get(projectId) as
    | { student_id: string }
    | undefined;
  return !!p && p.student_id === userId;
}

/** Replace group members (1–3). Keeps projects.student_id = first member for backward compat. */
export async function setProjectStudents(
  db: TmsDb,
  projectId: string,
  studentIds: string[],
  addedAt?: string
) {
  const unique = Array.from(new Set(studentIds.filter(Boolean)));
  if (unique.length < 1 || unique.length > 3) {
    throw new Error("A project group must have 1 to 3 students");
  }
  // Ensure all are students
  for (const sid of unique) {
    const u = (await db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(sid)) as
      | { id: string; role: string }
      | undefined;
    if (!u || u.role !== "student") throw new Error("All group members must be students");
    // Unique student across projects
    const other = (await db
      .prepare(
        `SELECT project_id FROM project_students WHERE student_id = ? AND project_id != ?`
      )
      .get(sid, projectId)) as { project_id: string } | undefined;
    if (other) throw new Error("Student is already assigned to another project");
  }
  // Capacity: idea places (slots) shared across all projects created from the idea
  const proj = (await db
    .prepare(`SELECT p.idea_id, i.slots FROM projects p LEFT JOIN ideas i ON i.id = p.idea_id WHERE p.id = ?`)
    .get(projectId)) as { idea_id: string | null; slots: number | null } | undefined;
  if (proj?.idea_id && proj.slots != null) {
    const slots = Math.max(1, Number(proj.slots) || 1);
    const others = await countFilledPlaces(db, proj.idea_id, projectId);
    if (others + unique.length > slots) {
      const left = Math.max(0, slots - others);
      throw new Error(
        `This idea has ${slots} place${slots === 1 ? "" : "s"} (${others} filled by other groups) — this group can have at most ${left} student${left === 1 ? "" : "s"}`
      );
    }
  }
  const t = addedAt || new Date().toISOString();
  await db.prepare(`DELETE FROM project_students WHERE project_id = ?`).run(projectId);
  for (const sid of unique) {
    await db
      .prepare(
        `INSERT INTO project_students (project_id, student_id, added_at) VALUES (?, ?, ?)`
      )
      .run(projectId, sid, t);
  }
  // Keep legacy column in sync with primary (first) student
  await db
    .prepare(`UPDATE projects SET student_id = ?, updated_at = ? WHERE id = ?`)
    .run(unique[0], t, projectId);
  if (proj?.idea_id) await recomputeSlotsFilled(db, proj.idea_id);
}

export async function canEditProjectContent(
  user: { id: string; role: string },
  project: { supervisor_id: string; student_id?: string; id: string }
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.id === project.supervisor_id) return true;
  return isProjectStudent(project.id, user.id);
}


export { logActivity, getDb, FORM_CODES };
export type { TmsDb };
