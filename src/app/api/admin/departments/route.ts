import { randomUUID } from "crypto";
import { getDb, logActivity, now } from "@/lib/db";
import { getSessionUser, jsonError } from "@/lib/auth";
import type { Department } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: jsonError("Unauthorized", 401) };
  if (user.role !== "admin") return { error: jsonError("Admin only", 403) };
  return { user };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const db = await getDb();
  const departments = (await db
    .prepare("SELECT * FROM departments ORDER BY name COLLATE NOCASE")
    .all()) as Department[];
  return Response.json({ departments });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return jsonError("Department name is required");
  const db = await getDb();
  const exists = await db.prepare(`SELECT id FROM departments WHERE lower(name) = lower(?)`).get(name);
  if (exists) return jsonError("Department already exists", 409);
  const id = randomUUID();
  await db.transaction(async () => {
    await db.prepare(`INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)`).run(id, name, now());
    await logActivity(db, { actor_id: auth.user!.id, actor_role: auth.user!.role, actor_name: auth.user!.name, action: "department_created", detail: `Added department “${name}”`, target_url: "/admin/departments" });
  });
  const department = (await db.prepare("SELECT * FROM departments WHERE id = ?").get(id)) as Department;
  return Response.json({ department }, { status: 201 });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  if (!id || !name) return jsonError("id and name are required");
  const db = await getDb();
  const target = (await db.prepare("SELECT * FROM departments WHERE id = ?").get(id)) as
    | Department
    | undefined;
  if (!target) return jsonError("Department not found", 404);
  const clash = (await db
    .prepare(`SELECT id FROM departments WHERE lower(name) = lower(?) AND id != ?`)
    .get(name, id)) as { id: string } | undefined;
  if (clash) return jsonError("Another department already has that name", 409);
  await db.transaction(async () => {
    await db.prepare(`UPDATE departments SET name = ? WHERE id = ?`).run(name, id);
    const moved = await db.prepare(`UPDATE users SET department = ? WHERE department = ?`).run(name, target.name);
    await logActivity(db, {
      actor_id: auth.user!.id, actor_role: auth.user!.role, actor_name: auth.user!.name,
      action: "department_renamed",
      detail: `Renamed department “${target.name}” → “${name}” (${moved.changes} user(s) updated)`,
      target_url: "/admin/departments",
    });
  });
  const department = (await db.prepare("SELECT * FROM departments WHERE id = ?").get(id)) as Department;
  return Response.json({ department });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("Department id required");
  const db = await getDb();
  const target = (await db.prepare("SELECT * FROM departments WHERE id = ?").get(id)) as
    | Department
    | undefined;
  if (!target) return jsonError("Department not found", 404);
  const refs = (await db
    .prepare(`SELECT COUNT(*) as c FROM users WHERE department = ?`)
    .get(target.name)) as { c: number };
  if (Number(refs.c) > 0) {
    return jsonError(
      `Cannot delete "${target.name}": ${refs.c} user(s) still reference it. Reassign them first.`,
      409
    );
  }
  await db.transaction(async () => {
    await db.prepare(`DELETE FROM departments WHERE id = ?`).run(id);
    await logActivity(db, { actor_id: auth.user!.id, actor_role: auth.user!.role, actor_name: auth.user!.name, action: "department_deleted", detail: `Deleted department “${target.name}”`, target_url: "/admin/departments" });
  });
  return Response.json({ ok: true, removed: target });
}
