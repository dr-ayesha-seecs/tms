import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity, now, formDisplayName } from "@/lib/db";
import { listGec, roleLabelForGec, FORM_CODES } from "@/lib/api-helpers";
import type { GecRole, ProgramType } from "@/lib/types";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const body = await req.json();
  const { target_type, target_id, project_id, method, signature_data, role_label } = body;
  if (!target_type || !target_id || !project_id || !signature_data) {
    return jsonError("target_type, target_id, project_id, signature_data required");
  }
  if (!["typed", "canvas"].includes(method || "typed")) return jsonError("Invalid method");

  const db = await getDb();
  const gec = await listGec(project_id) as { user_id: string; gec_role: GecRole }[];
  const membership = gec.find((g) => g.user_id === user.id);
  const isStudent = await db.prepare("SELECT student_id FROM projects WHERE id = ?").get(project_id) as
    | { student_id: string }
    | undefined;

  if (!membership && user.role !== "admin" && isStudent?.student_id !== user.id) {
    return jsonError("Not a project participant", 403);
  }

  const existing = await db
    .prepare(
      `SELECT id FROM signatures WHERE target_type = ? AND target_id = ? AND user_id = ?`
    )
    .get(target_type, target_id, user.id);
  if (existing) return jsonError("Already signed", 409);

  const label =
    role_label ||
    (membership ? roleLabelForGec(membership.gec_role) : user.role === "student" ? "Student" : user.title || user.role);

  const id = randomUUID();
  const t = now();
  await db.transaction(async () => {
  await db.prepare(
    `INSERT INTO signatures (id, target_type, target_id, project_id, user_id, role_label, method, signature_data, signed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, target_type, target_id, project_id, user.id, label, method || "typed", signature_data, t);

  if (target_type === "form") {
    // Check on THIS handle (inside the transaction) — a fresh getDb() would not see the uncommitted signature
    const gecCount = Number(
      ((await db.prepare("SELECT COUNT(*) as c FROM gec_members WHERE project_id = ?").get(project_id)) as { c: number }).c
    );
    const sigCount = Number(
      ((await db
        .prepare(`SELECT COUNT(DISTINCT user_id) as c FROM signatures WHERE target_type = 'form' AND target_id = ?`)
        .get(target_id)) as { c: number }).c
    );
    if (gecCount > 0 && sigCount >= gecCount) {
      await db.prepare(`UPDATE forms SET status = 'signed', updated_at = ? WHERE id = ?`).run(t, target_id);
      const form = await db.prepare("SELECT form_type FROM forms WHERE id = ?").get(target_id) as {
        form_type: string;
      };
      if (form?.form_type === FORM_CODES.GEC_FORMATION) {
        await db.prepare(
          `UPDATE projects SET acb_approved = 1, status = 'active', stage = 'proposal', updated_at = ? WHERE id = ?`
        ).run(t, project_id);
        await db.prepare(`UPDATE ideas SET status = 'converted', updated_at = ? WHERE id = (SELECT idea_id FROM projects WHERE id = ?)`).run(
          t,
          project_id
        );
      }
      if (form?.form_type === FORM_CODES.COMPLETION) {
        await db.prepare(
          `UPDATE projects SET stage = 'complete', status = 'completed', progress_pct = 100, updated_at = ? WHERE id = ?`
        ).run(t, project_id);
      }
      if (form?.form_type === FORM_CODES.PROPOSAL_RESULT) {
        const payload = JSON.parse(
          (await db.prepare("SELECT payload FROM forms WHERE id = ?").get(target_id) as { payload: string }).payload || "{}"
        );
        if (payload.result) {
          await db.prepare(
            `UPDATE defences SET result = ?, comments = ?, updated_at = ? WHERE project_id = ? AND defence_type = 'proposal' ORDER BY created_at DESC LIMIT 1`
          );
          // SQLite UPDATE ... ORDER BY LIMIT works in recent versions
          const def = await db
            .prepare(
              `SELECT id FROM defences WHERE project_id = ? AND defence_type = 'proposal' ORDER BY created_at DESC LIMIT 1`
            )
            .get(project_id) as { id: string } | undefined;
          if (def) {
            await db.prepare(`UPDATE defences SET result = ?, comments = ?, updated_at = ? WHERE id = ?`).run(
              payload.result,
              payload.comments || null,
              t,
              def.id
            );
          }
          if (payload.result === "pass" || payload.result === "conditional_pass") {
            const p = await db.prepare("SELECT progress_pct FROM projects WHERE id = ?").get(project_id) as {
              progress_pct: number;
            };
            await db.prepare(
              `UPDATE projects SET stage = 'research', status = 'proposal_passed', progress_pct = ?, updated_at = ? WHERE id = ?`
            ).run(Math.max(p.progress_pct, 45), t, project_id);
          }
        }
      }
    } else {
      await db.prepare(`UPDATE forms SET status = 'pending_signatures', updated_at = ? WHERE id = ?`).run(t, target_id);
    }
  }

  let what = `${target_type}`;
  if (target_type === "form") {
    const f = (await db
      .prepare(`SELECT f.form_type, f.status, p.program_type, p.title FROM forms f JOIN projects p ON p.id = f.project_id WHERE f.id = ?`)
      .get(target_id)) as { form_type: string; status: string; program_type: string; title: string } | undefined;
    if (f) {
      const lbl = await formDisplayName(db, (f.program_type || "MS_THESIS") as ProgramType, f.form_type);
      what = `form “${lbl}” on “${f.title}”${f.status === "signed" ? " — now fully signed" : ""}`;
    }
  } else if (target_type === "document") {
    const d = (await db
      .prepare(`SELECT d.title, d.version, p.title as ptitle FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = ?`)
      .get(target_id)) as { title: string; version: number; ptitle: string } | undefined;
    if (d) what = `document “${d.title}” v${d.version} on “${d.ptitle}”`;
  }
  await logActivity(db, {
    project_id,
    actor_id: user.id,
    actor_role: user.role,
    actor_name: user.name,
    action: "e_signed",
    detail: `E-signed ${what} as ${label} (${method || "typed"})`,
  });
  });

  return Response.json({
    signature: await db.prepare("SELECT * FROM signatures WHERE id = ?").get(id),
  }, { status: 201 });
}
