import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity, now } from "@/lib/db";
import { getProject, isProjectStudent } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function canEdit(user: { id: string; role: string }, projectId: string, supervisorId: string) {
  if (user.role === "admin" || user.id === supervisorId) return true;
  return isProjectStudent(projectId, user.id);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  if (!(await canEdit(user, params.id, project.supervisor_id))) return jsonError("Forbidden", 403);
  const body = await req.json();
  const { title, description, due_date, status, progress_pct } = body;
  if (!title) return jsonError("title required");
  const db = await getDb();
  const id = randomUUID();
  await db.transaction(async () => {
  await db
    .prepare(
      `INSERT INTO milestones (id, project_id, title, description, due_date, status, progress_pct, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.id,
      title,
      description || null,
      due_date || null,
      status || "pending",
      progress_pct || 0,
      now()
    );
  await logActivity(db, {
    project_id: params.id,
    actor_id: user.id, actor_role: user.role, actor_name: user.name,
    action: "milestone_created",
    detail: `Added milestone “${title}”${due_date ? ` (due ${due_date})` : ""} on “${project.title}”`,
  });
  });
  return Response.json(
    { milestone: await db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) },
    { status: 201 }
  );
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  if (!(await canEdit(user, params.id, project.supervisor_id))) return jsonError("Forbidden", 403);
  const body = await req.json();
  const { milestone_id, status, progress_pct, title, description, due_date } = body;
  if (!milestone_id) return jsonError("milestone_id required");
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (status !== undefined) {
    fields.push("status = ?");
    values.push(status);
  }
  if (progress_pct !== undefined) {
    fields.push("progress_pct = ?");
    values.push(progress_pct);
  }
  if (title !== undefined) {
    fields.push("title = ?");
    values.push(title);
  }
  if (description !== undefined) {
    fields.push("description = ?");
    values.push(description);
  }
  if (due_date !== undefined) {
    fields.push("due_date = ?");
    values.push(due_date);
  }
  const changed = fields.map((f) => f.split(" ")[0]);
  fields.push("updated_at = ?");
  values.push(now());
  values.push(milestone_id, params.id);
  await db.transaction(async () => {
  await db
    .prepare(`UPDATE milestones SET ${fields.join(", ")} WHERE id = ? AND project_id = ?`)
    .run(...values);

  const avg = (await db
    .prepare(`SELECT AVG(progress_pct) as a FROM milestones WHERE project_id = ?`)
    .get(params.id)) as { a: number };
  if (avg?.a != null) {
    await db
      .prepare(`UPDATE projects SET progress_pct = ?, updated_at = ? WHERE id = ?`)
      .run(Math.round(avg.a), now(), params.id);
  }
  const ms = (await db.prepare(`SELECT title, status, progress_pct FROM milestones WHERE id = ?`).get(milestone_id)) as
    | { title: string; status: string; progress_pct: number }
    | undefined;
  if (ms) {
    await logActivity(db, {
      project_id: params.id,
      actor_id: user.id, actor_role: user.role, actor_name: user.name,
      action: "milestone_updated",
      detail: `Milestone “${ms.title}” — ${changed.join(", ") || "touched"} (status ${ms.status}, ${ms.progress_pct}%) on “${project.title}”`,
    });
  }
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);
  const { searchParams } = new URL(req.url);
  const milestoneId = searchParams.get("milestone_id");
  if (!milestoneId) return jsonError("milestone_id required");
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT id, title FROM milestones WHERE id = ? AND project_id = ?`)
    .get(milestoneId, params.id)) as { title: string } | undefined;
  if (!row) return jsonError("Milestone not found", 404);
  await db.transaction(async () => {
    await db.prepare(`DELETE FROM milestones WHERE id = ?`).run(milestoneId);
    await logActivity(db, {
      project_id: params.id,
      actor_id: user.id, actor_role: user.role, actor_name: user.name,
      action: "milestone_deleted",
      detail: `Deleted milestone “${row.title}”`,
    });
  });
  return Response.json({ ok: true });
}
