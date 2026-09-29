import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import {
  DbPersistError,
  getDb,
  logActivity,
  now,
  VersionConflictError,
  withDbMutation,
} from "@/lib/db";
import { FILLED_SQL_FOR } from "@/lib/idea-capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getSessionUser())) return jsonError("Unauthorized", 401);
  const db = await getDb();
  const ideas = (await db
    .prepare(
      `SELECT i.*, ${FILLED_SQL_FOR("i")} as places_filled, u.name as faculty_name,
        (SELECT COUNT(*) FROM interests x WHERE x.idea_id = i.id) as interest_count
       FROM ideas i JOIN users u ON u.id = i.faculty_id
       ORDER BY i.created_at DESC`
    )
    .all()) as Record<string, unknown>[];
  // slots_filled is always the live count (the stored column is legacy)
  for (const i of ideas) i.slots_filled = i.places_filled;
  return Response.json({ ideas });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "faculty" && user.role !== "admin") {
    return jsonError("Only faculty can create ideas", 403);
  }
  const body = await req.json();
  const { title, abstract, domain, slots, program_type } = body;
  if (!title || !abstract || !domain) return jsonError("title, abstract, domain required");
  const program = program_type === "FYP" ? "FYP" : "MS_THESIS";
  const t = now();

  try {
    const idea = await withDbMutation(async (db) => {
      // New id per attempt so version-conflict retries cannot hit UNIQUE(ideas.id)
      const id = randomUUID();
      await db.transaction(async () => {
        await db
          .prepare(
            `INSERT INTO ideas (id, title, abstract, domain, slots, slots_filled, status, faculty_id, program_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 'open', ?, ?, ?, ?)`
          )
          .run(id, title, abstract, domain, Number(slots) || 1, user.id, program, t, t);
        await logActivity(db, {
          actor_id: user.id,
          actor_role: user.role,
          actor_name: user.name,
          action: "idea_created",
          detail: `“${title}” (${program === "FYP" ? "FYP" : "MS Thesis"}, ${Number(slots) || 1} place(s))`,
          target_url: `/ideas/${id}`,
        });
      });
      return await db.prepare("SELECT * FROM ideas WHERE id = ?").get(id);
    });
    return Response.json({ idea }, { status: 201 });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return jsonError("Conflict: database changed concurrently. Please retry.", 409);
    }
    if (e instanceof DbPersistError) {
      return jsonError(e.message, 500);
    }
    const msg = e instanceof Error ? e.message : "Create idea failed";
    console.error("[ideas POST]", e);
    return jsonError(msg, 500);
  }
}
