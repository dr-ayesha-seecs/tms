import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity, now } from "@/lib/db";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "student") return jsonError("Only students can express interest", 403);
  const { idea_id, statement } = await req.json();
  if (!idea_id) return jsonError("idea_id required");
  const db = await getDb();
  const idea = await db.prepare("SELECT * FROM ideas WHERE id = ?").get(idea_id) as
    | { status: string; title: string }
    | undefined;
  if (!idea) return jsonError("Idea not found", 404);
  if (idea.status === "converted" || idea.status === "closed") {
    return jsonError("Idea is not accepting interests");
  }
  try {
    const id = randomUUID();
    await db.transaction(async () => {
      await db.prepare(
        `INSERT INTO interests (id, idea_id, student_id, statement, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      ).run(id, idea_id, user.id, statement || null, now());
      await db.prepare(`UPDATE ideas SET status = 'interest_pending', updated_at = ? WHERE id = ? AND status = 'open'`).run(
        now(),
        idea_id
      );
      await logActivity(db, {
        actor_id: user.id,
        actor_role: user.role,
        actor_name: user.name,
        action: "interest_expressed",
        detail: `Interest in: ${idea.title}`,
        target_url: `/ideas/${idea_id}`,
      });
    });
    return Response.json({ interest: await db.prepare("SELECT * FROM interests WHERE id = ?").get(id) }, { status: 201 });
  } catch {
    return jsonError("Already expressed interest", 409);
  }
}
