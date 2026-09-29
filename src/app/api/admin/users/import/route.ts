import { randomUUID } from "crypto";
import { getSessionUser, jsonError } from "@/lib/auth";
import {
  DbPersistError,
  VersionConflictError,
  getDb,
  logActivity,
  withDbMutation,
} from "@/lib/db";
import type { User } from "@/lib/types";
import { defaultPasswordFor, hashPassword } from "@/lib/passwords";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportError = { row: number; email?: string; reason: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function normalizeHeader(h: unknown): string {
  return cellStr(h)
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[#]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function pickRegNo(canon: Record<string, string>): string {
  const keys = [
    "registration_no",
    "registration_number",
    "reg_no",
    "reg_number",
    "regno",
    "registration",
  ];
  for (const k of keys) {
    if (canon[k]) return canon[k];
  }
  // fuzzy: any key containing registration + no, or reg + no
  for (const [k, v] of Object.entries(canon)) {
    if (!v) continue;
    if (/reg(istration)?_?(no|num|number)?/.test(k) && !/email|name|dept|title/.test(k)) {
      return v;
    }
  }
  return "";
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Expected multipart/form-data with field file");
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError("Missing file field (upload a .xlsx or .xls)");
  }

  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    return jsonError("File must be .xlsx or .xls");
  }

  const ab = await file.arrayBuffer();
  if (!ab.byteLength) return jsonError("Empty file");

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(Buffer.from(ab), { type: "buffer" });
  } catch (e) {
    console.error("[users import] parse failed", e);
    return jsonError("Could not parse Excel file");
  }

  const sheetName =
    workbook.SheetNames.find((n) => n.toLowerCase() === "students") ||
    workbook.SheetNames[0];
  if (!sheetName) return jsonError("Workbook has no sheets");

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  if (!rawRows.length) {
    return Response.json({
      created: 0,
      skipped: 0,
      errors: [{ row: 0, reason: "No data rows found" }],
      users: [],
    });
  }

  const dbForDepts = await getDb();
  const deptRows = (await dbForDepts
    .prepare("SELECT name FROM departments ORDER BY name COLLATE NOCASE")
    .all()) as { name: string }[];
  const validDeptList = deptRows.map((d) => d.name);
  const deptByLower = new Map(validDeptList.map((n) => [n.toLowerCase(), n]));

  const mapped: {
    row: number;
    name: string;
    email: string;
    department: string;
    title: string;
    registration_no: string;
  }[] = [];
  const errors: ImportError[] = [];

  rawRows.forEach((raw, idx) => {
    const excelRow = idx + 2;
    const canon: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = normalizeHeader(k);
      const val = cellStr(v);
      // Do not let an empty alternate header overwrite a filled one
      // (e.g. registration_no* vs Registration No both map to registration_no)
      if (!val && canon[key]) continue;
      canon[key] = val;
    }
    const studentName = canon.name || canon.full_name || canon.student_name || "";
    const email = (canon.email || canon.e_mail || "").toLowerCase();
    let department = (canon.department || canon.dept || "").trim();
    if (department) {
      const canonDep = deptByLower.get(department.toLowerCase());
      if (!canonDep) {
        errors.push({
          row: excelRow,
          email: email || undefined,
          reason: `Unknown department "${department}". Valid: ${validDeptList.join(", ") || "(none — add departments first)"}`,
        });
        return;
      }
      department = canonDep;
    }
    const title = canon.title || canon.program || "";
    const registration_no = pickRegNo(canon);

    if (!studentName && !email && !department && !title && !registration_no) {
      return; // blank row
    }
    if (!studentName || !email) {
      errors.push({
        row: excelRow,
        email: email || undefined,
        reason: "name and email are required",
      });
      return;
    }
    if (!registration_no) {
      errors.push({
        row: excelRow,
        email,
        reason: "registration number is required",
      });
      return;
    }
    if (!department) {
      errors.push({
        row: excelRow,
        email,
        reason: `department is required. Valid: ${validDeptList.join(", ") || "(none — add departments first)"}`,
      });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ row: excelRow, email, reason: "invalid email" });
      return;
    }
    mapped.push({
      row: excelRow,
      name: studentName,
      email,
      department,
      title,
      registration_no,
    });
  });

  try {
    const result = await withDbMutation(async (db) => {
      const createdUsers: User[] = [];
      let skipped = 0;
      const batchErrors: ImportError[] = [...errors];
      const seenEmail = new Set<string>();
      const seenReg = new Set<string>();

      await db.transaction(async () => {
        for (const row of mapped) {
          const regKey = row.registration_no.toLowerCase();

          if (seenEmail.has(row.email)) {
            skipped += 1;
            batchErrors.push({
              row: row.row,
              email: row.email,
              reason: "duplicate email in file",
            });
            continue;
          }
          if (seenReg.has(regKey)) {
            skipped += 1;
            batchErrors.push({
              row: row.row,
              email: row.email,
              reason: "duplicate registration number in file",
            });
            continue;
          }
          seenEmail.add(row.email);
          seenReg.add(regKey);

          const existingEmail = await db
            .prepare("SELECT id FROM users WHERE email = ?")
            .get(row.email);
          if (existingEmail) {
            skipped += 1;
            batchErrors.push({
              row: row.row,
              email: row.email,
              reason: "email already registered (skipped)",
            });
            continue;
          }

          const existingReg = await db
            .prepare(
              `SELECT id FROM users WHERE lower(registration_no) = ? AND role = 'student'`
            )
            .get(regKey);
          if (existingReg) {
            skipped += 1;
            batchErrors.push({
              row: row.row,
              email: row.email,
              reason: "registration number already registered (skipped)",
            });
            continue;
          }

          const id = randomUUID();
          const created_at = new Date().toISOString();
          await db
            .prepare(
              `INSERT INTO users (id, email, name, role, department, title, registration_no, password_hash, must_change_password, created_at)
               VALUES (?, ?, ?, 'student', ?, ?, ?, ?, 1, ?)`
            )
            .run(
              id,
              row.email,
              row.name,
              row.department || null,
              row.title || null,
              row.registration_no,
              await hashPassword(defaultPasswordFor("student", row.registration_no)),
              created_at
            );

          const u = (await db.prepare("SELECT * FROM users WHERE id = ?").get(id)) as User;
          createdUsers.push(u);
        }
        if (createdUsers.length || skipped) {
          await logActivity(db, {
            actor_id: user.id,
            actor_role: user.role,
            actor_name: user.name,
            action: "users_imported",
            detail: `Bulk import: ${createdUsers.length} student(s) added, ${skipped} skipped${
              createdUsers.length
                ? ` — ${createdUsers
                    .slice(0, 10)
                    .map((u) => `${u.name} (${u.registration_no || u.email})`)
                    .join(", ")}${createdUsers.length > 10 ? `, +${createdUsers.length - 10} more` : ""}`
                : ""
            }`,
            target_url: "/admin/users",
          });
        }
      });

      return {
        created: createdUsers.length,
        skipped,
        errors: batchErrors,
        users: createdUsers,
      };
    });

    return Response.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return jsonError("Conflict: database changed concurrently. Please retry.", 409);
    }
    if (e instanceof DbPersistError) {
      return jsonError(e.message, 500);
    }
    const msg = e instanceof Error ? e.message : "Import failed";
    console.error("[users import]", e);
    return jsonError(msg, 500);
  }
}
