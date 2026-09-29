import { getSessionUser, jsonError, toPublicUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  return Response.json({
    user: toPublicUser(user),
    must_change_password: Number(user.must_change_password) === 1,
  });
}
