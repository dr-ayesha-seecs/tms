import { getDb } from "@/lib/db";
import { getSessionUser, jsonError } from "@/lib/auth";
import type { Department } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated department list for dropdowns (any logged-in role). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const db = await getDb();
  const departments = (await db
    .prepare("SELECT * FROM departments ORDER BY name COLLATE NOCASE")
    .all()) as Department[];
  return Response.json({ departments });
}
