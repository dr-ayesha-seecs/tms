import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity, now } from "@/lib/db";
import { getProject, listGec, roleLabelForGec } from "@/lib/api-helpers";
import type { GecRole } from "@/lib/types";

async function userName(db: Awaited<ReturnType<typeof getDb>>, id: string): Promise<string> {
  const u = (await db.prepare(`SELECT name FROM users WHERE id = ?`).get(id)) as { name: string } | undefined;
  return u?.name || "user";
}

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  if (user.role !== "admin" && user.id !== project.supervisor_id) {
    return jsonError("Only supervisor can invite GEC", 403);
  }
  const { user_id, gec_role } = await req.json();
  if (!user_id || !gec_role) return jsonError("user_id and gec_role required");
  const db = await getDb();
  const t = now();
  const invitee = await userName(db, user_id);
  try {
    await db.transaction(async () => {
      await db.prepare(
        `INSERT INTO gec_members (id, project_id, user_id, gec_role, invited_at, accepted_at)
         VALUES (?, ?, ?, ?, ?, NULL)`
      ).run(randomUUID(), params.id, user_id, gec_role, t);
      await logActivity(db, {
        project_id: params.id,
        actor_id: user.id,
        actor_role: user.role,
        actor_name: user.name,
        action: "gec_invited",
        detail: `Invited ${invitee} as ${roleLabelForGec(gec_role as GecRole)} on “${project.title}”`,
      });
    });
  } catch {
    return jsonError("Member already invited", 409);
  }
  return Response.json({ gec: await listGec(params.id) }, { status: 201 });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const body = await req.json();
  const { action, member_id, gec_role } = body as {
    action?: string;
    member_id?: string;
    gec_role?: string;
  };
  const db = await getDb();

  if (member_id && gec_role) {
    const project = await getProject(params.id);
    if (!project) return jsonError("Not found", 404);
    if (user.role !== "admin" && user.id !== project.supervisor_id) {
      return jsonError("Forbidden", 403);
    }
    if (gec_role === "supervisor") return jsonError("Cannot reassign supervisor role this way", 400);
    const member = (await db
      .prepare(`SELECT g.gec_role, u.name FROM gec_members g JOIN users u ON u.id = g.user_id WHERE g.id = ? AND g.project_id = ?`)
      .get(member_id, params.id)) as { gec_role: string; name: string } | undefined;
    await db.transaction(async () => {
      const r = await db
        .prepare(`UPDATE gec_members SET gec_role = ? WHERE id = ? AND project_id = ? AND gec_role != 'supervisor'`)
        .run(gec_role, member_id, params.id);
      if (member && r.changes > 0) {
        await logActivity(db, {
          project_id: params.id,
          actor_id: user.id,
          actor_role: user.role,
          actor_name: user.name,
          action: "gec_role_changed",
          detail: `${member.name}: ${roleLabelForGec(member.gec_role as GecRole)} → ${roleLabelForGec(gec_role as GecRole)} on “${project.title}”`,
        });
      }
    });
    return Response.json({ gec: await listGec(params.id) });
  }

  if (action === "accept") {
    const p = (await db.prepare(`SELECT title FROM projects WHERE id = ?`).get(params.id)) as { title: string } | undefined;
    await db.transaction(async () => {
      await db.prepare(
        `UPDATE gec_members SET accepted_at = ? WHERE project_id = ? AND user_id = ?`
      ).run(now(), params.id, user.id);
      await logActivity(db, {
        project_id: params.id,
        actor_id: user.id,
        actor_role: user.role,
        actor_name: user.name,
        action: "gec_accepted",
        detail: `Accepted GEC invitation${p ? ` on “${p.title}”` : ""}`,
      });
    });
    return Response.json({ gec: await listGec(params.id) });
  }
  return jsonError("Invalid action");
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);
  const { searchParams } = new URL(req.url);
  const memberId = searchParams.get("member_id");
  if (!memberId) return jsonError("member_id required");
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT g.*, u.name as user_name, p.title as project_title FROM gec_members g
       LEFT JOIN users u ON u.id = g.user_id LEFT JOIN projects p ON p.id = g.project_id
       WHERE g.id = ? AND g.project_id = ?`
    )
    .get(memberId, params.id)) as { gec_role: string; user_name: string | null; project_title: string | null } | undefined;
  if (!row) return jsonError("Member not found", 404);
  if (row.gec_role === "supervisor") {
    return jsonError("Cannot remove the supervisor from GEC", 400);
  }
  await db.transaction(async () => {
    await db.prepare(`DELETE FROM gec_members WHERE id = ?`).run(memberId);
    await logActivity(db, {
      project_id: params.id,
      actor_id: user.id,
      actor_role: user.role,
      actor_name: user.name,
      action: "gec_removed",
      detail: `Removed ${row.user_name || "member"} (${roleLabelForGec(row.gec_role as GecRole)}) from GEC of “${row.project_title || "project"}”`,
    });
  });
  return Response.json({ gec: await listGec(params.id) });
}
