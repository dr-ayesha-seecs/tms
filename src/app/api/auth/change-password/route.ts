import { getSessionUser, getSessionPasswordHash, jsonError, toPublicUser } from "@/lib/auth";
import { logActivity, withDbMutation } from "@/lib/db";
import { hashPassword, validateNewPassword, verifyPassword } from "@/lib/passwords";
import type { User } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);

  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body.current_password || "");
  const newPassword = String(body.new_password || "");
  const confirm = String(body.confirm_password || "");

  if (!currentPassword) return jsonError("Current password is required");
  if (!(await verifyPassword(currentPassword, await getSessionPasswordHash(user.id)))) {
    return jsonError("Current password is incorrect", 403);
  }

  const err = validateNewPassword(newPassword);
  if (err) return jsonError(err);
  if (newPassword !== confirm) return jsonError("New password and confirmation do not match");
  if (newPassword === currentPassword) {
    return jsonError("New password must differ from the current password");
  }

  const hash = await hashPassword(newPassword);
  const updated = await withDbMutation(async (db) => {
    await db.transaction(async () => {
      await db
        .prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`)
        .run(hash, user.id);
      await logActivity(db, {
        actor_id: user.id,
        actor_role: user.role,
        actor_name: user.name,
        action: "password_changed",
        detail: Number(user.must_change_password) === 1 ? "Changed first-login password" : "Changed own password",
        target_url: "/account/password",
      });
    });
    return (await db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)) as User;
  });

  return Response.json({ ok: true, user: toPublicUser(updated) });
}
