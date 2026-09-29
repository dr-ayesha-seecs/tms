import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb, resetFormTemplates, getFormTemplates, logActivity } from "@/lib/db";
import type { ProgramType } from "@/lib/types";
import type { FormCategory } from "@/lib/form-templates";

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: jsonError("Unauthorized", 401) };
  if (user.role !== "admin") return { error: jsonError("Admin only", 403) };
  return { user };
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const program = (searchParams.get("program") === "FYP" ? "FYP" : "MS_THESIS") as ProgramType;
  const db = await getDb();
  return Response.json({ program, templates: await getFormTemplates(db, program) });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  const program = (body.program === "FYP" ? "FYP" : "MS_THESIS") as ProgramType;
  const templates = body.templates as {
    id?: string;
    code: string;
    display_name: string;
    description?: string | null;
    sort_order: number;
    enabled: boolean | number;
    requires_esign: boolean | number;
    category: FormCategory;
  }[];

  if (!Array.isArray(templates)) return jsonError("templates array required");

  const db = await getDb();
  const before = (await getFormTemplates(db, program)) as {
    code: string;
    display_name: string;
    enabled: number;
  }[];
  await db.transaction(async () => {
    await db.prepare("DELETE FROM form_templates WHERE program_type = ?").run(program);
    const insert = await db.prepare(
      `INSERT INTO form_templates (id, program_type, code, display_name, description, sort_order, enabled, requires_esign, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const t of templates) {
      if (!t.code || !t.display_name) continue;
      await insert.run(
        t.id || randomUUID(),
        program,
        t.code.trim(),
        t.display_name.trim(),
        t.description ?? null,
        Number(t.sort_order) || 0,
        t.enabled ? 1 : 0,
        t.requires_esign ? 1 : 0,
        t.category || "document"
      );
    }
    const prev = new Map(before.map((b) => [b.code, b]));
    const changes: string[] = [];
    for (const t of templates) {
      if (!t.code || !t.display_name) continue;
      const b = prev.get(t.code.trim());
      if (!b) changes.push(`added ${t.code} “${t.display_name.trim()}”`);
      else {
        if (b.display_name !== t.display_name.trim()) changes.push(`${t.code}: “${b.display_name}” → “${t.display_name.trim()}”`);
        if (Number(b.enabled) !== (t.enabled ? 1 : 0)) changes.push(`${t.code} ${t.enabled ? "enabled" : "disabled"}`);
      }
      prev.delete(t.code.trim());
    }
    prev.forEach((b) => changes.push(`removed ${b.code} “${b.display_name}”`));
    await logActivity(db, {
      actor_id: auth.user!.id, actor_role: auth.user!.role, actor_name: auth.user!.name,
      action: "form_templates_updated",
      detail: `${program === "FYP" ? "FYP" : "MS Thesis"} form names: ${changes.slice(0, 15).join("; ") || "saved (no changes)"}${changes.length > 15 ? `; +${changes.length - 15} more` : ""}`,
      target_url: "/admin/forms",
    });
  });

  return Response.json({ ok: true, templates: await getFormTemplates(db, program) });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json();
  if (body.action !== "reset") return jsonError("Unknown action");
  const program = (body.program === "FYP" ? "FYP" : "MS_THESIS") as ProgramType;
  const db = await getDb();
  await db.transaction(async () => {
    await resetFormTemplates(db, program);
    await logActivity(db, {
      actor_id: auth.user!.id, actor_role: auth.user!.role, actor_name: auth.user!.name,
      action: "form_templates_reset",
      detail: `${program === "FYP" ? "FYP" : "MS Thesis"} form names reset to defaults`,
      target_url: "/admin/forms",
    });
  });
  return Response.json({ ok: true, templates: await getFormTemplates(db, program) });
}
