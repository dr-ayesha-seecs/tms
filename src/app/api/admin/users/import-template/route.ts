import { getSessionUser, jsonError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "admin") return jsonError("Admin only", 403);

  const db = await getDb();
  const depts = (await db
    .prepare("SELECT name FROM departments ORDER BY name COLLATE NOCASE")
    .all()) as { name: string }[];

  const wb = XLSX.utils.book_new();

  const exampleDept = depts[0]?.name || "Computer Science";
  const students = [
    {
      "registration_no*": "2026-MS-100",
      name: "Example Student",
      email: "example.student@university.edu",
      department: exampleDept,
      title: "MS Student",
    },
  ];
  const sheet = XLSX.utils.json_to_sheet(students, {
    header: ["registration_no*", "name", "email", "department", "title"],
  });
  sheet["!cols"] = [{ wch: 18 }, { wch: 24 }, { wch: 36 }, { wch: 22 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Students");

  const deptSheet = XLSX.utils.json_to_sheet(
    depts.length
      ? depts.map((d) => ({ department: d.name }))
      : [{ department: "(none yet — add under Admin → Departments)" }]
  );
  deptSheet["!cols"] = [{ wch: 40 }];
  XLSX.utils.book_append_sheet(wb, deptSheet, "Departments");

  const instructions = [
    {
      Column: "registration_no* (required)",
      Required: "yes",
      Notes:
        "University registration number. Unique among students. Also used as the initial password (must change on first login).",
    },
    { Column: "name", Required: "yes", Notes: "Full student name" },
    { Column: "email", Required: "yes", Notes: "Unique email; normalized to lowercase" },
    {
      Column: "department",
      Required: "yes",
      Notes:
        "Must match an existing department name exactly (case-insensitive). See the Departments sheet for valid names.",
    },
    { Column: "title", Required: "no", Notes: 'e.g. "BS Student" or "MS Student"' },
    {
      Column: "(role)",
      Required: "—",
      Notes: "Ignored if present — all imported rows become students",
    },
    {
      Column: "(blank rows)",
      Required: "—",
      Notes:
        "Skipped. Duplicate emails or registration numbers are skipped and listed in the import result.",
    },
  ];
  const help = XLSX.utils.json_to_sheet(instructions);
  help["!cols"] = [{ wch: 32 }, { wch: 10 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(wb, help, "Instructions");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buffer);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="tms-students-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
