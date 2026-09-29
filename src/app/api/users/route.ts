import { getSessionUser, jsonError, listUsers, toPublicUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getSessionUser())) return jsonError("Unauthorized", 401);
  const users = await listUsers();
  return Response.json({ users: users.map(toPublicUser) });
}
