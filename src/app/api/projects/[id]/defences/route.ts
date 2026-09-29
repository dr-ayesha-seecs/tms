import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity, now } from "@/lib/db";
import { getProject, th1Complete } from "@/lib/api-helpers";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  if (user.role !== "admin" && user.id !== project.supervisor_id) {
    return jsonError("Only supervisor can record defence results", 403);
  }
  if (!await th1Complete(params.id)) return jsonError("GEC/panel formation form must be signed");

  const body = await req.json();
  const { defence_id, result, comments, scheduled_at, venue } = body;
  if (!defence_id) return jsonError("defence_id required");

  // Schedule/venue edit (no result) — supervisor/admin only; students cannot change outcomes
  if (!result && (scheduled_at !== undefined || venue !== undefined || comments !== undefined)) {
    const db = await getDb();
    const defence = (await db
      .prepare("SELECT * FROM defences WHERE id = ? AND project_id = ?")
      .get(defence_id, params.id)) as { defence_type: string } | undefined;
    if (!defence) return jsonError("Defence not found", 404);
    const fields: string[] = [];
    const values: unknown[] = [];
    if (scheduled_at !== undefined) {
      fields.push("scheduled_at = ?");
      values.push(scheduled_at);
    }
    if (venue !== undefined) {
      fields.push("venue = ?");
      values.push(venue);
    }
    if (comments !== undefined) {
      fields.push("comments = ?");
      values.push(comments);
    }
    fields.push("updated_at = ?");
    values.push(now());
    values.push(defence_id);
    await db.transaction(async () => {
      await db.prepare(`UPDATE defences SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      await logActivity(db, {
        project_id: params.id,
        actor_id: user.id, actor_role: user.role, actor_name: user.name,
        action: "defence_rescheduled",
        detail:
          `${defence.defence_type.replace(/_/g, " ")} defence of “${project.title}”` +
          (scheduled_at !== undefined ? ` — time ${scheduled_at || "cleared"}` : "") +
          (venue !== undefined ? ` — venue ${venue || "cleared"}` : "") +
          (comments !== undefined ? " — comments edited" : ""),
      });
    });
    return Response.json({ ok: true });
  }

  if (!result) return jsonError("defence_id and result required");

  const db = await getDb();
  const defence = await db.prepare("SELECT * FROM defences WHERE id = ? AND project_id = ?").get(defence_id, params.id) as
    | { defence_type: string }
    | undefined;
  if (!defence) return jsonError("Defence not found", 404);

  const t = now();
  await db.transaction(async () => {
  await db.prepare(`UPDATE defences SET result = ?, comments = ?, updated_at = ? WHERE id = ?`).run(
    result,
    comments || null,
    t,
    defence_id
  );

  if (result === "pass" || result === "conditional_pass") {
    const p = await db.prepare("SELECT progress_pct FROM projects WHERE id = ?").get(params.id) as {
      progress_pct: number;
    };
    if (defence.defence_type === "proposal") {
      await db.prepare(
        `UPDATE projects SET stage = 'research', status = 'proposal_passed', progress_pct = ?, updated_at = ? WHERE id = ?`
      ).run(Math.max(p.progress_pct, 45), t, params.id);
    } else if (defence.defence_type === "in_house") {
      await db.prepare(
        `UPDATE projects SET stage = 'final', status = 'in_house_passed', progress_pct = ?, updated_at = ? WHERE id = ?`
      ).run(Math.max(p.progress_pct, 75), t, params.id);
    } else if (defence.defence_type === "final") {
      await db.prepare(
        `UPDATE projects SET stage = 'complete', status = 'final_passed', progress_pct = 95, updated_at = ? WHERE id = ?`
      ).run(t, params.id);
    }
  }

  await logActivity(db, {
    project_id: params.id,
    actor_id: user.id, actor_role: user.role, actor_name: user.name,
    action: "defence_result",
    detail: `${defence.defence_type.replace(/_/g, " ")} defence of “${project.title}”: ${String(result).replace(/_/g, " ")}`,
  });
  });

  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);
  const { searchParams } = new URL(req.url);
  const defenceId = searchParams.get("defence_id");
  if (!defenceId) return jsonError("defence_id required");
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT id, defence_type, scheduled_at FROM defences WHERE id = ? AND project_id = ?`)
    .get(defenceId, params.id)) as { defence_type: string; scheduled_at: string | null } | undefined;
  if (!row) return jsonError("Defence not found", 404);
  await db.transaction(async () => {
    await db.prepare(`DELETE FROM defences WHERE id = ?`).run(defenceId);
    await logActivity(db, {
      project_id: params.id,
      actor_id: user.id, actor_role: user.role, actor_name: user.name,
      action: "defence_deleted",
      detail: `Deleted ${row.defence_type.replace(/_/g, " ")} defence${row.scheduled_at ? ` scheduled ${row.scheduled_at}` : ""}`,
    });
  });
  return Response.json({ ok: true });
}
