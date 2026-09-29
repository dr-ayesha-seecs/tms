import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, logActivity } from "@/lib/db";
import type { Role, User } from "@/lib/types";
import { defaultPasswordFor, hashPassword } from "@/lib/passwords";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

const ALLOWED_ROLES: Role[] = ["faculty", "student", "external_examiner", "admin"];

function omitPassword(user: User) {
  const copy = { ...user } as User & { password_hash?: string | null };
  delete copy.password_hash;
  return copy;
}

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
  const users = await db.prepare("SELECT * FROM users ORDER BY role, name").all() as User[];
  return Response.json({ users: (users as User[]).map(omitPassword) });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = body.role as Role;
  let department = body.department ? String(body.department).trim() : null;
  const title = body.title ? String(body.title).trim() : null;
  const registration_no = body.registration_no
    ? String(body.registration_no).trim()
    : null;

  if (!name || !email) return jsonError("Name and email are required");
  if (!ALLOWED_ROLES.includes(role)) return jsonError("Invalid role");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Invalid email");
  if (role === "student" && !registration_no) {
    return jsonError("Registration number is required for students");
  }
  if (!department) {
    return jsonError("Department is required. Add departments under Admin → Departments.");
  }

  const db = await getDb();
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return jsonError("Email already registered", 409);

  if (registration_no) {
    const regTaken = await db
      .prepare(
        `SELECT id FROM users WHERE lower(registration_no) = lower(?) AND role = 'student'`
      )
      .get(registration_no);
    if (regTaken) return jsonError("Registration number already registered", 409);
  }

  const id = randomUUID();
  const created_at = new Date().toISOString();
  // Validate department against departments table when provided
  if (department) {
    const dep = await db
      .prepare(`SELECT name FROM departments WHERE lower(name) = lower(?)`)
      .get(department) as { name: string } | undefined;
    if (!dep) return jsonError("Unknown department. Add it under Admin → Departments first.", 400);
    department = dep.name;
  }

  let password_hash: string;
  try {
    password_hash = await hashPassword(defaultPasswordFor(role, registration_no));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not set default password", 400);
  }

  await db.transaction(async () => {
    await db.prepare(
      `INSERT INTO users (id, email, name, role, department, title, registration_no, password_hash, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, email, name, role, department, title, registration_no, password_hash, created_at);
    await logActivity(db, {
      actor_id: auth.user!.id, actor_role: auth.user!.role, actor_name: auth.user!.name,
      action: "user_created",
      detail: `Added ${role.replace("_", " ")} ${name} <${email}>${registration_no ? ` (${registration_no})` : ""} — ${department}`,
      target_url: "/admin/users",
    });
  });

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User;
  return Response.json({ user: omitPassword(user) }, { status: 201 });
}


export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  const id = String(body.id || "").trim();
  if (!id) return jsonError("User id required");

  const db = await getDb();
  const target = (await db.prepare("SELECT * FROM users WHERE id = ?").get(id)) as User | undefined;
  if (!target) return jsonError("User not found", 404);

  const name = body.name !== undefined ? String(body.name).trim() : target.name;
  const email =
    body.email !== undefined ? String(body.email).trim().toLowerCase() : target.email;
  const role = (body.role !== undefined ? body.role : target.role) as Role;
  let department =
    body.department !== undefined
      ? body.department
        ? String(body.department).trim()
        : null
      : target.department;
  const title =
    body.title !== undefined ? (body.title ? String(body.title).trim() : null) : target.title;
  const registration_no =
    body.registration_no !== undefined
      ? body.registration_no
        ? String(body.registration_no).trim()
        : null
      : target.registration_no;

  if (!name || !email) return jsonError("Name and email are required");
  if (!ALLOWED_ROLES.includes(role)) return jsonError("Invalid role");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("Invalid email");
  if (role === "student" && !registration_no) {
    return jsonError("Registration number is required for students");
  }
  if (department) {
    const dep = (await db
      .prepare(`SELECT name FROM departments WHERE lower(name) = lower(?)`)
      .get(department)) as { name: string } | undefined;
    if (!dep) return jsonError("Unknown department. Add it under Admin → Departments first.", 400);
    department = dep.name;
  }

  const emailTaken = (await db
    .prepare(`SELECT id FROM users WHERE email = ? AND id != ?`)
    .get(email, id)) as { id: string } | undefined;
  if (emailTaken) return jsonError("Email already registered", 409);

  if (registration_no) {
    const regTaken = (await db
      .prepare(
        `SELECT id FROM users WHERE lower(registration_no) = lower(?) AND role = 'student' AND id != ?`
      )
      .get(registration_no, id)) as { id: string } | undefined;
    if (regTaken) return jsonError("Registration number already registered", 409);
  }

  const finalReg = role === "student" ? registration_no : registration_no;
  const diffs: string[] = [];
  const cmp = (label: string, a: unknown, b: unknown) => {
    if ((a ?? "") !== (b ?? "")) diffs.push(`${label}: ${a || "—"} → ${b || "—"}`);
  };
  cmp("name", target.name, name);
  cmp("email", target.email, email);
  cmp("role", target.role, role);
  cmp("department", target.department, department);
  cmp("title", target.title, title);
  cmp("reg no", target.registration_no, finalReg);
  await db.transaction(async () => {
    await db
      .prepare(
        `UPDATE users SET name = ?, email = ?, role = ?, department = ?, title = ?, registration_no = ? WHERE id = ?`
      )
      .run(name, email, role, department, title, finalReg, id);
    await logActivity(db, {
      actor_id: auth.user!.id, actor_role: auth.user!.role, actor_name: auth.user!.name,
      action: "user_updated",
      detail: `Edited ${name} <${email}>: ${diffs.join("; ") || "no changes"}`,
      target_url: "/admin/users",
    });
  });

  const user = (await db.prepare("SELECT * FROM users WHERE id = ?").get(id)) as User;
  return Response.json({ user: omitPassword(user) });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("User id required");

  if (id === auth.user!.id) return jsonError("You cannot remove your own admin account");

  const db = await getDb();
  const target = await db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
  if (!target) return jsonError("User not found", 404);

  const refs: string[] = [];
  const asStudent = (await db.prepare("SELECT COUNT(*) as c FROM projects WHERE student_id = ?").get(id) as { c: number }).c;
  const asGroupMember = (await db.prepare("SELECT COUNT(*) as c FROM project_students WHERE student_id = ?").get(id) as { c: number }).c;
  const asSupervisor = (await db.prepare("SELECT COUNT(*) as c FROM projects WHERE supervisor_id = ?").get(id) as { c: number }).c;
  const asGec = (await db.prepare("SELECT COUNT(*) as c FROM gec_members WHERE user_id = ?").get(id) as { c: number }).c;
  const asFacultyIdeas = (await db.prepare("SELECT COUNT(*) as c FROM ideas WHERE faculty_id = ?").get(id) as { c: number }).c;
  const asInterest = (await db.prepare("SELECT COUNT(*) as c FROM interests WHERE student_id = ?").get(id) as { c: number }).c;
  if (asStudent) refs.push(`${asStudent} project(s) as student`);
  if (asGroupMember) refs.push(`${asGroupMember} project group membership(s)`);
  if (asSupervisor) refs.push(`${asSupervisor} project(s) as supervisor`);
  if (asGec) refs.push(`${asGec} GEC membership(s)`);
  if (asFacultyIdeas) refs.push(`${asFacultyIdeas} idea(s)`);
  if (asInterest) refs.push(`${asInterest} interest(s)`);
  if (refs.length) {
    return jsonError(
      `Cannot remove ${target.name}: still linked to ${refs.join(", ")}. Reassign or close those first.`,
      409
    );
  }

  await db.transaction(async () => {
    await db.prepare("DELETE FROM signatures WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM notification_reads WHERE user_id = ?").run(id);
    // Keep their activity history (audit trail): snapshot name/role so rows still read correctly
    await db
      .prepare(
        `UPDATE activity SET actor_name = COALESCE(actor_name, ?), actor_role = COALESCE(actor_role, ?) WHERE actor_id = ?`
      )
      .run(target.name, target.role, id);
    await db.prepare("DELETE FROM user_visits WHERE user_id = ?").run(id);
    await db.prepare("DELETE FROM users WHERE id = ?").run(id);
    await logActivity(db, {
      actor_id: auth.user!.id, actor_role: auth.user!.role, actor_name: auth.user!.name,
      action: "user_deleted",
      detail: `Deleted ${target.role.replace("_", " ")} ${target.name} <${target.email}>${target.registration_no ? ` (${target.registration_no})` : ""}`,
      target_url: "/admin/users",
    });
  });
  return Response.json({ ok: true, removed: omitPassword(target) });
}
