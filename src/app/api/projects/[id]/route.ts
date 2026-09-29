import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, withDbMutation, VersionConflictError, DbPersistError, now, logActivity } from "@/lib/db";
import {
  getProject,
  listGec,
  getSignatures,
  listProjectStudents,
  setProjectStudents,
} from "@/lib/api-helpers";
import { recomputeSlotsFilled } from "@/lib/idea-capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  const db = await getDb();
  const students = await listProjectStudents(params.id);
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
  const documents = await db
    .prepare(
      `SELECT d.*, u.name as uploader_name FROM documents d
       JOIN users u ON u.id = d.uploaded_by
       WHERE d.project_id = ? ORDER BY d.created_at DESC`
    )
    .all(params.id);
  const forms = await db
    .prepare(`SELECT * FROM forms WHERE project_id = ? ORDER BY created_at DESC`)
    .all(params.id);
  const activity = await db
    .prepare(
      `SELECT a.*, COALESCE(u.name, a.actor_name) as actor_name FROM activity a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT 30`
    )
    .all(params.id);

  const formsWithSigs = await Promise.all(
    (forms as { id: string }[]).map(async (f) => ({
      ...f,
      signatures: await getSignatures("form", f.id),
    }))
  );
  const docsWithSigs = await Promise.all(
    (documents as { id: string }[]).map(async (d) => ({
      ...d,
      signatures: await getSignatures("document", d.id),
    }))
  );

  return Response.json({
    project: { ...project, students },
    students,
    gec,
    meetings,
    milestones,
    defences,
    documents: docsWithSigs,
    forms: formsWithSigs,
    activity,
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  if (user.role !== "admin" && user.id !== project.supervisor_id) {
    return jsonError("Forbidden", 403);
  }
  const body = await req.json();

  try {
    await withDbMutation(async (db) => db.transaction(async () => {
      const fields: string[] = [];
      const values: unknown[] = [];
      for (const key of [
        "stage",
        "status",
        "progress_pct",
        "acb_approved",
        "title",
        "abstract",
        "domain",
        "program_type",
      ] as const) {
        if (body[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(body[key]);
        }
      }
      if (fields.length) {
        fields.push("updated_at = ?");
        values.push(now());
        values.push(params.id);
        await db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      }

      if (Array.isArray(body.student_ids)) {
        await setProjectStudents(db, params.id, body.student_ids);
      }

      if (!fields.length && !Array.isArray(body.student_ids)) {
        throw new Error("NO_FIELDS");
      }

      const changed = fields.filter((f) => !f.startsWith("updated_at")).map((f) => f.split(" ")[0]);
      if (changed.length) {
        await logActivity(db, {
          project_id: params.id,
          actor_id: user.id,
          actor_role: user.role,
          actor_name: user.name,
          action: "project_updated",
          detail:
            `“${body.title ?? project.title}” — changed ${changed.join(", ")}` +
            (body.stage !== undefined ? ` (stage → ${body.stage})` : "") +
            (body.status !== undefined ? ` (status → ${body.status})` : ""),
        });
      }
      if (Array.isArray(body.student_ids)) {
        const names = (await db
          .prepare(
            `SELECT u.name, u.registration_no FROM project_students ps JOIN users u ON u.id = ps.student_id
             WHERE ps.project_id = ? ORDER BY u.name`
          )
          .all(params.id)) as { name: string; registration_no: string | null }[];
        await logActivity(db, {
          project_id: params.id,
          actor_id: user.id,
          actor_role: user.role,
          actor_name: user.name,
          action: "project_members_changed",
          detail: `“${project.title}” group: ${names.map((n) => `${n.name}${n.registration_no ? ` (${n.registration_no})` : ""}`).join(", ")}`,
        });
      }
    }));
  } catch (e) {
    if (e instanceof Error && e.message === "NO_FIELDS") return jsonError("No fields");
    if (e instanceof Error && /1 to 3|already|must be students|place/i.test(e.message)) {
      return jsonError(e.message, 400);
    }
    if (e instanceof VersionConflictError) return jsonError("Conflict — retry", 409);
    if (e instanceof DbPersistError) return jsonError(e.message, 500);
    throw e;
  }

  const students = await listProjectStudents(params.id);
  return Response.json({ project: { ...(await getProject(params.id)), students }, students });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);

  try {
    await withDbMutation(async (db) => {
      const project = (await db
        .prepare("SELECT id, idea_id, title FROM projects WHERE id = ?")
        .get(params.id)) as { id: string; idea_id: string | null; title: string } | undefined;
      if (!project) throw new Error("NOT_FOUND");
      await db.transaction(async () => {
        await db.prepare("DELETE FROM signatures WHERE project_id = ?").run(params.id);
        await db.prepare("DELETE FROM documents WHERE project_id = ?").run(params.id);
        await db.prepare("DELETE FROM forms WHERE project_id = ?").run(params.id);
        await db.prepare("DELETE FROM meetings WHERE project_id = ?").run(params.id);
        await db.prepare("DELETE FROM milestones WHERE project_id = ?").run(params.id);
        await db.prepare("DELETE FROM defences WHERE project_id = ?").run(params.id);
        await db.prepare("DELETE FROM gec_members WHERE project_id = ?").run(params.id);
        await db.prepare("DELETE FROM project_students WHERE project_id = ?").run(params.id);
        // activity rows are kept (audit trail); the log entry below records the deletion
        await db.prepare("DELETE FROM projects WHERE id = ?").run(params.id);
        if (project.idea_id) await recomputeSlotsFilled(db, project.idea_id);
        await logActivity(db, {
          actor_id: user.id,
          actor_role: user.role,
          actor_name: user.name,
          action: "project_deleted",
          detail: `Deleted project “${project.title}” and its meetings, milestones, documents, forms, defences and GEC`,
          target_url: "/projects",
        });
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return jsonError("Not found", 404);
    if (e instanceof VersionConflictError) return jsonError("Conflict — retry", 409);
    if (e instanceof DbPersistError) return jsonError(e.message, 500);
    throw e;
  }
  return Response.json({ ok: true });
}
