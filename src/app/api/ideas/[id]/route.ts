import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity } from "@/lib/db";
import { FILLED_SQL_FOR, countFilledPlaces, recomputeSlotsFilled } from "@/lib/idea-capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!(await getSessionUser())) return jsonError("Unauthorized", 401);
  const db = await getDb();
  const idea = (await db
    .prepare(
      `SELECT i.*, ${FILLED_SQL_FOR("i")} as places_filled, u.name as faculty_name FROM ideas i
       JOIN users u ON u.id = i.faculty_id WHERE i.id = ?`
    )
    .get(params.id)) as Record<string, unknown> | undefined;
  if (!idea) return jsonError("Idea not found", 404);
  idea.slots_filled = idea.places_filled;
  const interests = await db
    .prepare(
      `SELECT x.*, s.name as student_name, s.email as student_email, s.registration_no as student_registration_no
       FROM interests x
       JOIN users s ON s.id = x.student_id WHERE x.idea_id = ? ORDER BY x.created_at`
    )
    .all(params.id);
  return Response.json({ idea, interests });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const db = await getDb();
  const idea = (await db.prepare("SELECT * FROM ideas WHERE id = ?").get(params.id)) as
    | { faculty_id: string; title: string; status: string }
    | undefined;
  if (!idea) return jsonError("Idea not found", 404);
  if (user.role !== "admin" && idea.faculty_id !== user.id) {
    return jsonError("Forbidden", 403);
  }
  const body = await req.json();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of ["title", "abstract", "domain", "slots", "status", "program_type"] as const) {
    if (body[key] !== undefined) {
      if (key === "program_type" && body[key] !== "FYP" && body[key] !== "MS_THESIS") {
        return jsonError("program_type must be FYP or MS_THESIS");
      }
      if (key === "slots") {
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < 1 || n > 3) {
          return jsonError("slots (group size) must be 1–3");
        }
        const filled = await countFilledPlaces(db, params.id);
        if (n < filled) {
          return jsonError(`Cannot set places below the ${filled} student(s) already on this idea's project(s)`);
        }
        fields.push(`${key} = ?`);
        values.push(n);
        continue;
      }
      fields.push(`${key} = ?`);
      values.push(body[key]);
    }
  }
  if (!fields.length) return jsonError("No fields");
  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(params.id);
  const changed = fields.map((f) => f.split(" ")[0]).filter((f) => f !== "updated_at");
  await db.transaction(async () => {
    await db.prepare(`UPDATE ideas SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    await recomputeSlotsFilled(db, params.id);
    const newTitle = body.title !== undefined ? String(body.title) : idea.title;
    await logActivity(db, {
      actor_id: user.id,
      actor_role: user.role,
      actor_name: user.name,
      action: "idea_updated",
      detail:
        `“${newTitle}” — changed ${changed.join(", ")}` +
        (body.status !== undefined && body.status !== idea.status ? ` (status ${idea.status} → ${body.status})` : ""),
      target_url: `/ideas/${params.id}`,
    });
  });
  return Response.json({
    idea: await db
      .prepare(`SELECT i.*, ${FILLED_SQL_FOR("i")} as places_filled FROM ideas i WHERE i.id = ?`)
      .get(params.id),
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);
  const db = await getDb();
  const idea = (await db.prepare("SELECT * FROM ideas WHERE id = ?").get(params.id)) as
    | { title: string }
    | undefined;
  if (!idea) return jsonError("Idea not found", 404);
  const linked = (await db
    .prepare("SELECT COUNT(*) as c FROM projects WHERE idea_id = ?")
    .get(params.id)) as { c: number };
  if (Number(linked.c) > 0) {
    return jsonError("Cannot delete idea with linked projects. Delete projects first.", 409);
  }
  await db.transaction(async () => {
    await db.prepare("DELETE FROM interests WHERE idea_id = ?").run(params.id);
    await db.prepare("DELETE FROM ideas WHERE id = ?").run(params.id);
    await logActivity(db, {
      actor_id: user.id,
      actor_role: user.role,
      actor_name: user.name,
      action: "idea_deleted",
      detail: `“${idea.title}” deleted (with its interests)`,
      target_url: "/ideas",
    });
  });
  return Response.json({ ok: true });
}
