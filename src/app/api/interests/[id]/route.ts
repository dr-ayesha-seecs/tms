import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import {
  getDb,
  logActivity,
  now,
  withDbMutation,
  VersionConflictError,
  DbPersistError,
} from "@/lib/db";
import { setProjectStudents } from "@/lib/api-helpers";
import { countFilledPlaces, recomputeSlotsFilled } from "@/lib/idea-capacity";
import { validateGecInvites } from "@/lib/gec-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const db = await getDb();
  const interest = (await db
    .prepare(
      `SELECT x.*, i.faculty_id, i.title as idea_title, i.abstract, i.domain, i.id as idea_id, i.program_type
       FROM interests x JOIN ideas i ON i.id = x.idea_id WHERE x.id = ?`
    )
    .get(params.id)) as
    | {
        id: string;
        student_id: string;
        faculty_id: string;
        status: string;
        statement: string | null;
        idea_title: string;
        abstract: string;
        domain: string;
        idea_id: string;
        program_type: string;
      }
    | undefined;
  if (!interest) return jsonError("Interest not found", 404);

  const body = await req.json();

  // Edit statement (owner or admin)
  if (body.statement !== undefined && !body.action) {
    if (user.role !== "admin" && user.id !== interest.student_id) {
      return jsonError("Forbidden", 403);
    }
    if (interest.status !== "pending" && user.role !== "admin") {
      return jsonError("Only pending interests can be edited", 400);
    }
    try {
      await withDbMutation(async (mdb) => {
        await mdb.transaction(async () => {
          await mdb
            .prepare(`UPDATE interests SET statement = ? WHERE id = ?`)
            .run(String(body.statement || "").trim() || null, params.id);
          await logActivity(mdb, {
            actor_id: user.id,
            actor_role: user.role,
            actor_name: user.name,
            action: "interest_edited",
            detail: `Edited interest statement on “${interest.idea_title}”`,
            target_url: `/ideas/${interest.idea_id}`,
          });
        });
      });
    } catch (e) {
      if (e instanceof VersionConflictError) return jsonError("Conflict — retry", 409);
      if (e instanceof DbPersistError) return jsonError(e.message, 500);
      throw e;
    }
    const refreshed = await getDb();
    return Response.json({
      interest: await refreshed.prepare("SELECT * FROM interests WHERE id = ?").get(params.id),
    });
  }

  const { action, gec_invites, student_ids } = body as {
    action: "accept" | "reject" | "withdraw";
    gec_invites?: { user_id: string; gec_role: string }[];
    student_ids?: string[];
  };

  if (action === "withdraw") {
    if (user.id !== interest.student_id && user.role !== "admin") {
      return jsonError("Forbidden", 403);
    }
    try {
      await withDbMutation(async (mdb) => {
        await mdb.transaction(async () => {
          await mdb.prepare(`UPDATE interests SET status = 'withdrawn' WHERE id = ?`).run(params.id);
          await logActivity(mdb, {
            actor_id: user.id,
            actor_role: user.role,
            actor_name: user.name,
            action: "interest_withdrawn",
            detail: `Withdrew interest in “${interest.idea_title}”`,
            target_url: `/ideas/${interest.idea_id}`,
          });
        });
      });
    } catch (e) {
      if (e instanceof VersionConflictError) return jsonError("Conflict — retry", 409);
      if (e instanceof DbPersistError) return jsonError(e.message, 500);
      throw e;
    }
    return Response.json({ ok: true });
  }

  if (user.role !== "admin" && user.id !== interest.faculty_id) {
    return jsonError("Only supervising faculty can accept/reject", 403);
  }

  if (action === "reject") {
    try {
      await withDbMutation(async (mdb) => {
        await mdb.transaction(async () => {
          await mdb.prepare(`UPDATE interests SET status = 'rejected' WHERE id = ?`).run(params.id);
          const st = (await mdb
            .prepare(`SELECT name, registration_no FROM users WHERE id = ?`)
            .get(interest.student_id)) as { name: string; registration_no: string | null } | undefined;
          await logActivity(mdb, {
            actor_id: user.id,
            actor_role: user.role,
            actor_name: user.name,
            action: "interest_rejected",
            detail: `Rejected ${st?.name || "student"}${st?.registration_no ? ` (${st.registration_no})` : ""} on “${interest.idea_title}”`,
            target_url: `/ideas/${interest.idea_id}`,
          });
        });
      });
    } catch (e) {
      if (e instanceof VersionConflictError) return jsonError("Conflict — retry", 409);
      if (e instanceof DbPersistError) return jsonError(e.message, 500);
      throw e;
    }
    return Response.json({ ok: true });
  }

  if (action !== "accept") return jsonError("Invalid action");

  const normalizedInvites = (gec_invites || [])
    .filter((inv) => inv && String(inv.user_id || "").trim())
    .map((inv) => ({
      user_id: String(inv.user_id).trim(),
      gec_role: String(inv.gec_role || "").trim(),
    }));
  const inviteError = validateGecInvites(interest.program_type, normalizedInvites);
  if (inviteError) return jsonError(inviteError, 400);

  let groupIds = Array.isArray(student_ids) ? student_ids.filter(Boolean) : [interest.student_id];
  if (!groupIds.includes(interest.student_id)) groupIds = [interest.student_id, ...groupIds];
  groupIds = Array.from(new Set(groupIds));
  if (groupIds.length < 1 || groupIds.length > 3) {
    return jsonError("Select 1 to 3 students for the project group", 400);
  }

  for (const sid of groupIds) {
    const row = (await db
      .prepare(`SELECT id, status FROM interests WHERE idea_id = ? AND student_id = ?`)
      .get(interest.idea_id, sid)) as { id: string; status: string } | undefined;
    if (!row) return jsonError("All group members must have expressed interest in this idea", 400);
    if (sid !== interest.student_id && row.status !== "pending") {
      return jsonError("Only pending interested students can be added to the group", 400);
    }
    const already = (await db
      .prepare(`SELECT project_id FROM project_students WHERE student_id = ?`)
      .get(sid)) as { project_id: string } | undefined;
    if (already) return jsonError("A selected student is already on another project", 409);
  }

  {
    const cap = (await db.prepare(`SELECT slots FROM ideas WHERE id = ?`).get(interest.idea_id)) as
      | { slots: number }
      | undefined;
    const slots = Math.max(1, Number(cap?.slots) || 1);
    const filled = await countFilledPlaces(db, interest.idea_id);
    if (filled + groupIds.length > slots) {
      const left = Math.max(0, slots - filled);
      return jsonError(
        `This idea has ${slots} place${slots === 1 ? "" : "s"} and ${filled} ${filled === 1 ? "is" : "are"} already filled — you can accept at most ${left} more student${left === 1 ? "" : "s"}.`,
        409
      );
    }
  }

  let projectId: string | null = null;
  try {
    projectId = await withDbMutation(async (mdb) => {
      const t = now();
      const pid = randomUUID();
      await mdb.transaction(async () => {
        for (const sid of groupIds) {
          await mdb
            .prepare(
              `UPDATE interests SET status = 'accepted' WHERE idea_id = ? AND student_id = ? AND status = 'pending'`
            )
            .run(interest.idea_id, sid);
        }
        await mdb
          .prepare(
            `UPDATE ideas SET status = 'gec_forming', updated_at = ? WHERE id = ?`
          )
          .run(t, interest.idea_id);

        await mdb
          .prepare(
            `INSERT INTO projects (id, idea_id, title, abstract, domain, student_id, supervisor_id, stage, status, progress_pct, acb_approved, program_type, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'gec_formation', 'draft', 5, 0, ?, ?, ?)`
          )
          .run(
            pid,
            interest.idea_id,
            interest.idea_title,
            interest.abstract,
            interest.domain,
            groupIds[0],
            interest.faculty_id,
            interest.program_type || "MS_THESIS",
            t,
            t
          );

        await setProjectStudents(mdb, pid, groupIds, t);
        await recomputeSlotsFilled(mdb, interest.idea_id);

        await mdb
          .prepare(
            `INSERT INTO gec_members (id, project_id, user_id, gec_role, invited_at, accepted_at)
             VALUES (?, ?, ?, 'supervisor', ?, ?)`
          )
          .run(randomUUID(), pid, interest.faculty_id, t, t);

        for (const inv of normalizedInvites) {
          if (inv.user_id === interest.faculty_id) continue;
          await mdb
            .prepare(
              `INSERT OR IGNORE INTO gec_members (id, project_id, user_id, gec_role, invited_at, accepted_at)
               VALUES (?, ?, ?, ?, ?, NULL)`
            )
            .run(randomUUID(), pid, inv.user_id, inv.gec_role, t);
        }

        const names = (await mdb
          .prepare(
            `SELECT name, registration_no FROM users WHERE id IN (${groupIds.map(() => "?").join(",")}) ORDER BY name`
          )
          .all(...groupIds)) as { name: string; registration_no: string | null }[];
        await logActivity(mdb, {
          project_id: pid,
          actor_id: user.id,
          actor_role: user.role,
          actor_name: user.name,
          action: "student_accepted",
          detail: `Accepted ${names
            .map((n) => `${n.name}${n.registration_no ? ` (${n.registration_no})` : ""}`)
            .join(", ")} on “${interest.idea_title}” — project created`,
          target_url: `/projects/${pid}`,
        });
      });
      return pid;
    });
  } catch (e) {
    if (e instanceof VersionConflictError) return jsonError("Conflict — retry", 409);
    if (e instanceof DbPersistError) return jsonError(e.message, 500);
    const msg = e instanceof Error ? e.message : "Accept failed";
    if (/1 to 3|already assigned|must be students|place/i.test(msg)) return jsonError(msg, 400);
    console.error("[interests PATCH accept]", e);
    return jsonError(msg, 500);
  }

  return Response.json({ ok: true, project_id: projectId });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);
  try {
    await withDbMutation(async (mdb) => {
      const interest = (await mdb
        .prepare(
          `SELECT x.id, x.idea_id, i.title as idea_title, u.name as student_name
           FROM interests x LEFT JOIN ideas i ON i.id = x.idea_id LEFT JOIN users u ON u.id = x.student_id
           WHERE x.id = ?`
        )
        .get(params.id)) as { id: string; idea_id: string; idea_title: string | null; student_name: string | null } | undefined;
      if (!interest) throw new Error("NOT_FOUND");
      await mdb.transaction(async () => {
        await mdb.prepare("DELETE FROM interests WHERE id = ?").run(params.id);
        await logActivity(mdb, {
          actor_id: user.id,
          actor_role: user.role,
          actor_name: user.name,
          action: "interest_deleted",
          detail: `Deleted ${interest.student_name || "a student"}'s interest on “${interest.idea_title || "idea"}”`,
          target_url: `/ideas/${interest.idea_id}`,
        });
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") return jsonError("Interest not found", 404);
    if (e instanceof VersionConflictError) return jsonError("Conflict — retry", 409);
    if (e instanceof DbPersistError) return jsonError(e.message, 500);
    throw e;
  }
  return Response.json({ ok: true });
}
