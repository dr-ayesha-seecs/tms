import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import { withDbMutation, logActivity, now } from "@/lib/db";
import { getProject, isProjectStudent } from "@/lib/api-helpers";
import { isGoogleDocsOrDriveUrl, normalizeGoogleUrl } from "@/lib/google-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOC_TYPES = [
  "synopsis",
  "proposal",
  "slides",
  "thesis_draft",
  "final_thesis",
  "form",
  "meeting_notes",
  "other",
];

async function canSubmit(user: { id: string; role: string }, projectId: string, supervisorId: string) {
  if (user.role === "admin" || user.id === supervisorId) return true;
  if (await isProjectStudent(projectId, user.id)) return true;
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  const gec = await db
    .prepare(`SELECT 1 as ok FROM gec_members WHERE project_id = ? AND user_id = ?`)
    .get(projectId, user.id);
  return !!gec;
}

/** Submit a Google Docs / Drive link (no file uploads — saves storage). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  if (!(await canSubmit(user, params.id, project.supervisor_id))) return jsonError("Forbidden", 403);

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const doc_type = String(body.doc_type || "").trim();
  const url = normalizeGoogleUrl(String(body.external_url || body.url || ""));
  const note = body.note != null ? String(body.note) : body.content_text != null ? String(body.content_text) : "";
  const shared = body.shared_with_gec === true || body.shared_with_gec === 1 || body.shared_with_gec === "true";

  if (body.file_name || body.file || body.file_data) {
    return jsonError("File uploads are disabled. Submit a Google Docs/Drive link instead.");
  }
  if (!title) return jsonError("Title is required");
  if (!DOC_TYPES.includes(doc_type)) return jsonError("Invalid document type");
  if (!url) return jsonError("Google Docs/Drive link is required");
  if (!isGoogleDocsOrDriveUrl(url)) {
    return jsonError("Link must be an https://docs.google.com or https://drive.google.com URL");
  }
  if (!shared) {
    return jsonError("Please confirm you have shared the document with the GEC members with edit access");
  }

  const doc = await withDbMutation(async (db) => db.transaction(async () => {
    const prev = (await db
      .prepare(`SELECT MAX(version) as v FROM documents WHERE project_id = ? AND title = ?`)
      .get(params.id, title)) as { v: number | null };
    const ver = (prev?.v || 0) + 1;
    const id = randomUUID();
    await db
      .prepare(
        `INSERT INTO documents (id, project_id, title, doc_type, version, file_name, content_text, external_url, shared_with_gec, uploaded_by, requires_signatures, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, ?)`
      )
      .run(id, params.id, title, doc_type, ver, note || null, url, user.id, body.requires_signatures ? 1 : 0, now());
    await logActivity(db, {
      project_id: params.id,
      actor_id: user.id,
      actor_role: user.role,
      actor_name: user.name,
      action: "document_link_submitted",
      detail: `${title} v${ver} (${doc_type.replace(/_/g, " ")}) on “${project.title}”`,
    });
    return db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
  }));
  return Response.json({ document: doc }, { status: 201 });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  const project = await getProject(params.id);
  if (!project) return jsonError("Not found", 404);
  const body = await req.json().catch(() => ({}));
  const docId = String(body.document_id || "");
  if (!docId) return jsonError("document_id required");

  if (body.external_url !== undefined) {
    const u = normalizeGoogleUrl(String(body.external_url));
    if (!isGoogleDocsOrDriveUrl(u)) {
      return jsonError("Link must be an https://docs.google.com or https://drive.google.com URL");
    }
    body.external_url = u;
  }
  if (body.doc_type !== undefined && !DOC_TYPES.includes(String(body.doc_type))) {
    return jsonError("Invalid document type");
  }

  const result = await withDbMutation(async (db) => {
    const doc = (await db
      .prepare(`SELECT * FROM documents WHERE id = ? AND project_id = ?`)
      .get(docId, params.id)) as { uploaded_by: string; title: string; version: number } | undefined;
    if (!doc) return { error: "Document not found", status: 404 };
    if (user.role !== "admin" && user.id !== project.supervisor_id && user.id !== doc.uploaded_by) {
      return { error: "Forbidden", status: 403 };
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ["title", "doc_type", "content_text", "external_url"] as const) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(body[key]);
      }
    }
    if (body.note !== undefined) {
      fields.push("content_text = ?");
      values.push(body.note);
    }
    if (body.requires_signatures !== undefined) {
      fields.push("requires_signatures = ?");
      values.push(body.requires_signatures ? 1 : 0);
    }
    if (!fields.length) return { error: "No fields", status: 400 };
    values.push(docId);
    await db.transaction(async () => {
      await db.prepare(`UPDATE documents SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      await logActivity(db, {
        project_id: params.id,
        actor_id: user.id,
        actor_role: user.role,
        actor_name: user.name,
        action: "document_link_updated",
        detail: `${body.title ?? doc.title} v${doc.version} — changed ${fields.map((f) => f.split(" ")[0]).join(", ")}`,
      });
    });
    return { document: await db.prepare("SELECT * FROM documents WHERE id = ?").get(docId) };
  });
  if ("error" in result) return jsonError(String(result.error), Number(result.status));
  return Response.json(result);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);
  const { searchParams } = new URL(req.url);
  const docId = searchParams.get("document_id");
  if (!docId) return jsonError("document_id required");
  const res = await withDbMutation(async (db) => {
    const doc = (await db
      .prepare(`SELECT id, title, version FROM documents WHERE id = ? AND project_id = ?`)
      .get(docId, params.id)) as { title: string; version: number } | undefined;
    if (!doc) return false;
    await db.transaction(async () => {
      await db.prepare(`DELETE FROM signatures WHERE target_type = 'document' AND target_id = ?`).run(docId);
      await db.prepare(`DELETE FROM documents WHERE id = ?`).run(docId);
      await logActivity(db, {
        project_id: params.id,
        actor_id: user.id,
        actor_role: user.role,
        actor_name: user.name,
        action: "document_deleted",
        detail: `Deleted document ${doc.title} v${doc.version}`,
      });
    });
    return true;
  });
  if (!res) return jsonError("Document not found", 404);
  return Response.json({ ok: true });
}
