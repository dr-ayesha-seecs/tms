import { getSessionUser, jsonError } from "@/lib/auth";
import { logActivity, withDbMutation } from "@/lib/db";
import { defaultPasswordFor, hashPassword } from "@/lib/passwords";
import type { Role, User } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const admin = await getSessionUser();
  if (!admin) return jsonError("Unauthorized", 401);
  if (admin.role !== "admin") return jsonError("Admin only", 403);

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || body.user_id || "").trim();
  if (!id) return jsonError("User id required");

  try {
    const result = await withDbMutation(async (db) => {
      const target = (await db.prepare("SELECT * FROM users WHERE id = ?").get(id)) as User | undefined;
      if (!target) return { error: "User not found", status: 404 as const };
      let plain: string;
      try {
        plain = defaultPasswordFor(target.role as Role, target.registration_no);
      } catch (e) {
        return {
          error: e instanceof Error ? e.message : "Cannot set default password",
          status: 400 as const,
        };
      }
      const hash = await hashPassword(plain);
      await db.transaction(async () => {
        await db
          .prepare(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`)
          .run(hash, id);
        await logActivity(db, {
          actor_id: admin.id,
          actor_role: admin.role,
          actor_name: admin.name,
          action: "password_reset",
          detail: `Reset password of ${target.name} <${target.email}> to the default (must change on next login)`,
          target_url: "/admin/users",
        });
      });
      return {
        ok: true as const,
        role: target.role,
        default_hint: target.role === "student" ? "their registration number" : "Mnsuam@123",
        message:
          target.role === "student"
            ? "Password reset to the student's registration number. They must change it on next login."
            : "Password reset to the default staff password (Mnsuam@123). They must change it on next login.",
      };
    });
    if ("error" in result && result.error) {
      return jsonError(result.error, result.status || 400);
    }
    return Response.json(result);
  } catch (e) {
    console.error("[reset-password]", e);
    return jsonError("Could not reset password", 500);
  }
}
