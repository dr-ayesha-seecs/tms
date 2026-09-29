import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const db = await getDb();
  let projects;
  if (user.role === "admin") {
    projects = await db
      .prepare(
        `SELECT p.*, s.name as student_name, f.name as supervisor_name
         FROM projects p
         JOIN users s ON s.id = p.student_id
         JOIN users f ON f.id = p.supervisor_id
         ORDER BY p.updated_at DESC`
      )
      .all();
  } else if (user.role === "student") {
    projects = await db
      .prepare(
        `SELECT p.*, s.name as student_name, f.name as supervisor_name
         FROM projects p
         JOIN users s ON s.id = p.student_id
         JOIN users f ON f.id = p.supervisor_id
         WHERE p.student_id = ?
         ORDER BY p.updated_at DESC`
      )
      .all(user.id);
  } else {
    projects = await db
      .prepare(
        `SELECT DISTINCT p.*, s.name as student_name, f.name as supervisor_name
         FROM projects p
         JOIN users s ON s.id = p.student_id
         JOIN users f ON f.id = p.supervisor_id
         LEFT JOIN gec_members g ON g.project_id = p.id
         WHERE p.supervisor_id = ? OR g.user_id = ?
         ORDER BY p.updated_at DESC`
      )
      .all(user.id, user.id);
  }
  return Response.json({ projects });
}
