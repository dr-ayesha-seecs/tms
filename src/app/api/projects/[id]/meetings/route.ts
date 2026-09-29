import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity, now } from "@/lib/db";
import { getProject } from "@/lib/api-helpers";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  const body = await req.json();
  const { meeting_date, agenda, attendance, notes, next_actions, venue } = body;
  if (!meeting_date || !agenda) return jsonError("meeting_date and agenda required");
  const db = await getDb();
  const id = randomUUID();
  await db.transaction(async () => {
  await db.prepare(
    `INSERT INTO meetings (id, project_id, meeting_date, agenda, attendance, notes, next_actions, venue, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.id,
    meeting_date,
    agenda,
    JSON.stringify(attendance || []),
    notes || "",
    next_actions || "",
    venue || null,
    user.id,
    now()
  );
  await logActivity(db, {
    project_id: params.id,
    actor_id: user.id, actor_role: user.role, actor_name: user.name,
    action: "meeting_logged",
    detail: `Meeting on ${meeting_date} for “${project.title}”: ${String(agenda).slice(0, 200)}`,
  });
  });
  return Response.json({ meeting: await db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) }, { status: 201 });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  const body = await req.json();
  const meetingId = body.meeting_id as string;
  if (!meetingId) return jsonError("meeting_id required");
  const db = await getDb();
  const meeting = (await db
    .prepare(`SELECT * FROM meetings WHERE id = ? AND project_id = ?`)
    .get(meetingId, params.id)) as { created_by: string } | undefined;
  if (!meeting) return jsonError("Meeting not found", 404);
  if (
    user.role !== "admin" &&
    user.id !== project.supervisor_id &&
    user.id !== meeting.created_by
  ) {
    return jsonError("Forbidden", 403);
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of ["meeting_date", "agenda", "notes", "next_actions", "attendance", "venue"] as const) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(key === "attendance" ? JSON.stringify(body[key]) : body[key]);
    }
  }
  if (!fields.length) return jsonError("No fields");
  values.push(meetingId, params.id);
  await db.transaction(async () => {
    await db.prepare(`UPDATE meetings SET ${fields.join(", ")} WHERE id = ? AND project_id = ?`).run(...values);
    const m = (await db.prepare(`SELECT meeting_date, agenda FROM meetings WHERE id = ?`).get(meetingId)) as
      | { meeting_date: string; agenda: string }
      | undefined;
    await logActivity(db, {
      project_id: params.id,
      actor_id: user.id, actor_role: user.role, actor_name: user.name,
      action: "meeting_updated",
      detail: `Edited meeting ${m?.meeting_date || ""} (${fields.map((f) => f.split(" ")[0]).join(", ")}) on “${project.title}”`,
    });
  });
  return Response.json({
    meeting: await db.prepare("SELECT * FROM meetings WHERE id = ?").get(meetingId),
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);
  const { searchParams } = new URL(req.url);
  const meetingId = searchParams.get("meeting_id");
  if (!meetingId) return jsonError("meeting_id required");
  const db = await getDb();
  const meeting = (await db
    .prepare(`SELECT id, meeting_date, agenda FROM meetings WHERE id = ? AND project_id = ?`)
    .get(meetingId, params.id)) as { meeting_date: string; agenda: string } | undefined;
  if (!meeting) return jsonError("Meeting not found", 404);
  await db.transaction(async () => {
    await db.prepare(`DELETE FROM meetings WHERE id = ?`).run(meetingId);
    await logActivity(db, {
      project_id: params.id,
      actor_id: user.id, actor_role: user.role, actor_name: user.name,
      action: "meeting_deleted",
      detail: `Deleted meeting ${meeting.meeting_date}: ${String(meeting.agenda).slice(0, 120)}`,
    });
  });
  return Response.json({ ok: true });
}
