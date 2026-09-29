import { logActivity, resetDb, withDbMutation } from "@/lib/db";
import { getSessionUser, jsonError } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);
  await resetDb();
  try {
    await withDbMutation((db) =>
      logActivity(db, {
        actor_id: user.id,
        actor_role: user.role,
        actor_name: user.name,
        action: "db_reseeded",
        detail: "Full re-seed: database wiped and default users + form templates re-created",
        target_url: "/admin",
      })
    );
  } catch (e) {
    console.warn("[seed] could not log reseed", e);
  }
  return Response.json({
    ok: true,
    message: "Database re-seeded (users + form templates; no demo ideas/projects)",
  });
}
