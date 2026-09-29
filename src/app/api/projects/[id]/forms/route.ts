import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity, now, formDisplayName } from "@/lib/db";
import { getProject, th1Complete, listGec, FORM_CODES } from "@/lib/api-helpers";
import type { FormType, ProgramType } from "@/lib/types";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);

  const body = await req.json();
  const { form_type, payload } = body as { form_type: FormType; payload?: Record<string, unknown> };
  if (!form_type) return jsonError("form_type (template code) required");

  const program = (project.program_type || "MS_THESIS") as ProgramType;
  const label = await formDisplayName(await getDb(), program, form_type);

  if (
    form_type !== FORM_CODES.GEC_FORMATION &&
    form_type !== FORM_CODES.GEC_CHANGE &&
    !await th1Complete(params.id)
  ) {
    return jsonError(`GEC/panel formation form must be fully signed before creating "${label}"`);
  }
  if (
    form_type === FORM_CODES.PROPOSAL_SCHEDULE ||
    form_type === FORM_CODES.PROPOSAL_RESULT
  ) {
    if (!await th1Complete(params.id)) {
      return jsonError("Cannot schedule proposal without signed GEC/panel formation form");
    }
  }

  const db = await getDb();
  const id = randomUUID();
  const t = now();
  const gec = await listGec(params.id) as { gec_role: string; user_id: string }[];

  let finalPayload = payload || {};
  if (form_type === FORM_CODES.GEC_FORMATION) {
    finalPayload = {
      ...finalPayload,
      gec: gec.map((g) => ({
        role: g.gec_role,
        user_id: g.user_id,
      })),
    };
  }

  const scheduleLog = async (kind: string, payload: { scheduled_at?: string; venue?: string }) =>
    logActivity(db, {
      project_id: params.id,
      actor_id: user.id,
      actor_role: user.role,
      actor_name: user.name,
      action: "defence_scheduled",
      detail: `${kind} defence of “${project.title}”${payload.scheduled_at ? ` on ${payload.scheduled_at}` : ""}${payload.venue ? ` at ${payload.venue}` : ""}`,
    });

  await db.transaction(async () => {
  await db.prepare(
    `INSERT INTO forms (id, project_id, form_type, status, payload, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'pending_signatures', ?, ?, ?, ?)`
  ).run(id, params.id, form_type, JSON.stringify(finalPayload), user.id, t, t);

  if (form_type === FORM_CODES.PROPOSAL_SCHEDULE) {
    const scheduled_at = (finalPayload as { scheduled_at?: string }).scheduled_at || null;
    const venue = (finalPayload as { venue?: string }).venue || null;
    const synopsis_doc_id = (finalPayload as { synopsis_doc_id?: string }).synopsis_doc_id || null;
    const slides_doc_id = (finalPayload as { slides_doc_id?: string }).slides_doc_id || null;
    await db.prepare(
      `INSERT INTO defences (id, project_id, defence_type, scheduled_at, venue, result, synopsis_doc_id, slides_doc_id, created_at, updated_at)
       VALUES (?, ?, 'proposal', ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(randomUUID(), params.id, scheduled_at, venue, synopsis_doc_id, slides_doc_id, t, t);
    await scheduleLog("Proposal", finalPayload as { scheduled_at?: string; venue?: string });
    await db.prepare(
      `UPDATE projects SET stage = 'proposal', status = 'proposal_scheduled', updated_at = ? WHERE id = ?`
    ).run(t, params.id);
  }

  if (form_type === FORM_CODES.INHOUSE_DEFENCE || form_type === FORM_CODES.MID_EVALUATION) {
    const scheduled_at = (finalPayload as { scheduled_at?: string }).scheduled_at || null;
    const venue = (finalPayload as { venue?: string }).venue || null;
    const dtype = form_type === FORM_CODES.MID_EVALUATION ? "in_house" : "in_house";
    await db.prepare(
      `INSERT INTO defences (id, project_id, defence_type, scheduled_at, venue, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(randomUUID(), params.id, dtype, scheduled_at, venue, t, t);
    await scheduleLog("In-house", finalPayload as { scheduled_at?: string; venue?: string });
    await db.prepare(
      `UPDATE projects SET stage = 'in_house', status = 'in_house_scheduled', updated_at = ? WHERE id = ?`
    ).run(t, params.id);
  }

  if (form_type === FORM_CODES.FINAL_DEFENCE) {
    const scheduled_at = (finalPayload as { scheduled_at?: string }).scheduled_at || null;
    const venue = (finalPayload as { venue?: string }).venue || null;
    await db.prepare(
      `INSERT INTO defences (id, project_id, defence_type, scheduled_at, venue, result, created_at, updated_at)
       VALUES (?, ?, 'final', ?, ?, 'pending', ?, ?)`
    ).run(randomUUID(), params.id, scheduled_at, venue, t, t);
    await scheduleLog("Final", finalPayload as { scheduled_at?: string; venue?: string });
    await db.prepare(
      `UPDATE projects SET stage = 'final', status = 'final_scheduled', updated_at = ? WHERE id = ?`
    ).run(t, params.id);
  }

  await logActivity(db, {
    project_id: params.id,
    actor_id: user.id,
    actor_role: user.role,
    actor_name: user.name,
    action: "form_created",
    detail: `${label} created for “${project.title}”`,
  });
  });

  return Response.json({ form: await db.prepare("SELECT * FROM forms WHERE id = ?").get(id) }, { status: 201 });
}
