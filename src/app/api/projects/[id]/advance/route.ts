import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity, now } from "@/lib/db";
import { getProject, th1Complete, listGec } from "@/lib/api-helpers";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

/**
 * Demo helper: advance project with validation gates.
 * Actions: finalize_gec | simulate_acb | mark_research | complete
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  if (user.role !== "admin" && user.id !== project.supervisor_id) {
    return jsonError("Only supervisor/admin can advance", 403);
  }

  const { action } = await req.json();
  const db = await getDb();
  const t = now();
  const gec = await listGec(params.id) as { accepted_at: string | null; gec_role: string }[];

  if (action === "finalize_gec") {
    const roles = new Set(gec.map((g) => g.gec_role));
    if (!roles.has("supervisor") || !roles.has("internal_examiner") || !roles.has("external_examiner")) {
      return jsonError("GEC needs supervisor, internal examiner, and external examiner");
    }
    const pending = gec.filter((g) => !g.accepted_at);
    await db.transaction(async () => {
    if (pending.length) {
      // Auto-accept remaining for demo convenience when supervisor finalizes
      await db.prepare(`UPDATE gec_members SET accepted_at = ? WHERE project_id = ? AND accepted_at IS NULL`).run(
        t,
        params.id
      );
    }
    await db.prepare(
      `UPDATE projects SET stage = 'gec_formation', status = 'acb_pending', updated_at = ? WHERE id = ?`
    ).run(t, params.id);
    await logActivity(db, { project_id: params.id, actor_id: user.id, actor_role: user.role, actor_name: user.name, action: "gec_finalized", detail: `GEC finalized for “${project.title}” — ready for ACB` });
    });
    return Response.json({ ok: true, next: "Create/sign GEC formation form, then simulate ACB" });
  }

  if (action === "simulate_acb") {
    if (!await th1Complete(params.id)) return jsonError("GEC/panel formation form must be fully e-signed before ACB approval");
    await db.transaction(async () => {
    await db.prepare(
      `UPDATE projects SET acb_approved = 1, status = 'active', stage = 'proposal', updated_at = ? WHERE id = ?`
    ).run(t, params.id);
    await db.prepare(
      `UPDATE ideas SET status = 'converted', updated_at = ? WHERE id = (SELECT idea_id FROM projects WHERE id = ?)`
    ).run(t, params.id);
    await logActivity(db, { project_id: params.id, actor_id: user.id, actor_role: user.role, actor_name: user.name, action: "acb_approved", detail: `ACB approval recorded for “${project.title}”` });
    });
    return Response.json({ ok: true });
  }

  if (action === "mark_research") {
    if (project.status !== "proposal_passed" && project.status !== "research") {
      return jsonError("Proposal defence must be passed first");
    }
    await db.transaction(async () => {
      await db.prepare(`UPDATE projects SET stage = 'research', status = 'research', updated_at = ? WHERE id = ?`).run(
        t,
        params.id
      );
      await logActivity(db, { project_id: params.id, actor_id: user.id, actor_role: user.role, actor_name: user.name, action: "research_started", detail: `“${project.title}” moved to research stage` });
    });
    return Response.json({ ok: true });
  }

  if (action === "complete") {
    if (!await th1Complete(params.id)) return jsonError("GEC/panel formation form required");
    const th4 = await db
      .prepare(`SELECT id, status FROM forms WHERE project_id = ? AND form_type = 'completion' ORDER BY created_at DESC LIMIT 1`)
      .get(params.id) as { id: string; status: string } | undefined;
    if (!th4 || (th4.status !== "signed" && th4.status !== "approved")) {
      return jsonError("Completion form must be fully signed");
    }
    await db.transaction(async () => {
    await db.prepare(
      `UPDATE projects SET stage = 'complete', status = 'completed', progress_pct = 100, updated_at = ? WHERE id = ?`
    ).run(t, params.id);
    await logActivity(db, { project_id: params.id, actor_id: user.id, actor_role: user.role, actor_name: user.name, action: "project_completed", detail: `“${project.title}” completed — graduation clearance` });
    });
    return Response.json({ ok: true });
  }

  return jsonError("Unknown action");
}
