import { getSessionUser, jsonError } from "@/lib/auth";
import { withDbMutation, VersionConflictError, DbPersistError, logActivity } from "@/lib/db";
import { getProject, listProjectStudents, setProjectStudents } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (!(await getProject(params.id))) return jsonError("Not found", 404);
  return Response.json({ students: await listProjectStudents(params.id) });
}

/** Body: { student_ids: string[] } — replace group (1–3). Supervisor or admin. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  if (user.role !== "admin" && user.id !== project.supervisor_id) {
    return jsonError("Forbidden", 403);
  }
  const body = await req.json();
  const student_ids = body.student_ids as string[];
  if (!Array.isArray(student_ids)) return jsonError("student_ids array required");
  try {
    await withDbMutation(async (db) =>
      db.transaction(async () => {
        await setProjectStudents(db, params.id, student_ids);
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
          detail: `“${project.title}” group: ${names
            .map((n) => `${n.name}${n.registration_no ? ` (${n.registration_no})` : ""}`)
            .join(", ")}`,
        });
      })
    );
  } catch (e) {
    if (e instanceof Error && /1 to 3|already|must be students|place/i.test(e.message)) {
      return jsonError(e.message, 400);
    }
    if (e instanceof VersionConflictError) return jsonError("Conflict — retry", 409);
    if (e instanceof DbPersistError) return jsonError(e.message, 500);
    throw e;
  }
  return Response.json({ students: await listProjectStudents(params.id) });
}
