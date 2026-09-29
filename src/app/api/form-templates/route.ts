import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, getFormTemplates } from "@/lib/db";
import type { ProgramType } from "@/lib/types";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const { searchParams } = new URL(req.url);
  const program = (searchParams.get("program") === "FYP" ? "FYP" : "MS_THESIS") as ProgramType;
  const enabledOnly = searchParams.get("enabled") !== "0";
  const db = await getDb();
  return Response.json({ program, templates: await getFormTemplates(db, program, enabledOnly) });
}
