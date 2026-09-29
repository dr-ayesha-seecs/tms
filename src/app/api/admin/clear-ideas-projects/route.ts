import { getSessionUser, jsonError } from "@/lib/auth";
import {
  clearIdeasAndProjects,
  DbPersistError,
  getDb,
  logActivity,
  VersionConflictError,
  withDbMutation,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);

  try {
    // Up to 3 full clear+verify cycles for multi-instance write races
    let counts = { ideas: -1, projects: -1, users: 0, templates: 0 };
    for (let attempt = 0; attempt < 3; attempt++) {
      await withDbMutation(async (db) => {
        const before = (await db
          .prepare(`SELECT (SELECT COUNT(*) FROM ideas) as ideas, (SELECT COUNT(*) FROM projects) as projects`)
          .get()) as { ideas: number; projects: number };
        await db.transaction(async () => {
          await clearIdeasAndProjects(db);
          if (Number(before.ideas) || Number(before.projects) || attempt === 0) {
            await logActivity(db, {
              actor_id: user.id,
              actor_role: user.role,
              actor_name: user.name,
              action: "data_cleared",
              detail: `Cleared all ideas & projects (${before.ideas} idea(s), ${before.projects} project(s) and related records). Users, form templates and the activity log were kept.`,
              target_url: "/admin",
            });
          }
        });
      });
      const verify = await getDb();
      const ideas = ((await verify.prepare("SELECT COUNT(*) as c FROM ideas").get()) as { c: number }).c;
      const projects = ((await verify.prepare("SELECT COUNT(*) as c FROM projects").get()) as { c: number }).c;
      const users = ((await verify.prepare("SELECT COUNT(*) as c FROM users").get()) as { c: number }).c;
      const templates = ((await verify.prepare("SELECT COUNT(*) as c FROM form_templates").get()) as {
        c: number;
      }).c;
      counts = { ideas: Number(ideas), projects: Number(projects), users: Number(users), templates: Number(templates) };
      if (counts.ideas === 0 && counts.projects === 0) {
        return Response.json({
          ok: true,
          message: "All ideas and projects cleared",
          counts,
        });
      }
    }
    return jsonError(
      `Clear did not stick (ideas=${counts.ideas}, projects=${counts.projects}). Please retry.`,
      500
    );
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return jsonError("Conflict: database changed concurrently. Please retry.", 409);
    }
    if (e instanceof DbPersistError) {
      return jsonError(e.message, 500);
    }
    const msg = e instanceof Error ? e.message : "Clear failed";
    console.error("[clear-ideas-projects]", e);
    return jsonError(msg, 500);
  }
}
