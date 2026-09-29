"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Department, Role, User } from "@/lib/types";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "faculty", label: "Faculty" },
  { value: "student", label: "Student" },
  { value: "external_examiner", label: "External examiner" },
  { value: "admin", label: "Admin" },
];

const FILTERS: { value: "all" | Role; label: string }[] = [
  { value: "all", label: "All" },
  { value: "faculty", label: "Faculty" },
  { value: "student", label: "Students" },
  { value: "external_examiner", label: "External examiners" },
  { value: "admin", label: "Admins" },
];

type ImportError = { row: number; email?: string; reason: string };

type ImportResult = {
  created: number;
  skipped: number;
  errors: ImportError[];
  users?: User[];
  error?: string;
};

function roleLabel(role: Role) {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label || role;
}

const emptyForm = {
  name: "",
  email: "",
  role: "faculty" as Role,
  department: "",
  title: "",
  registration_no: "",
};

export function AdminUsersEditor() {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [filter, setFilter] = useState<"all" | Role>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<User | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError("");
    const [usersRes, deptRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/departments"),
    ]);
    const usersData = await usersRes.json();
    const deptData = await deptRes.json();
    setLoading(false);
    if (!usersRes.ok) {
      setError(usersData.error || "Failed to load users");
      return;
    }
    setUsers(usersData.users || []);
    if (deptRes.ok) setDepartments(deptData.departments || []);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? users : users.filter((u) => u.role === filter)),
    [users, filter]
  );

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (form.role === "student" && !form.registration_no.trim()) {
      setError("Registration number is required for students");
      return;
    }
    if (!form.department.trim()) {
      setError("Select a department (add one under Admin → Departments if needed)");
      return;
    }
    setBusy(true);
    setMsg("");
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not add user");
      return;
    }
    const hint =
      form.role === "student"
        ? ` Initial password = registration number (${form.registration_no.trim()}).`
        : " Initial password = Mnsuam@123.";
    setMsg(`Added ${data.user.name}.${hint} They must change it on first login.`);
    setForm({ ...emptyForm, role: form.role, department: form.department });
    await load();
  }

  function startEdit(u: User) {
    setEditing(u);
    setEditForm({
      name: u.name,
      email: u.email,
      role: u.role,
      department: u.department || "",
      title: u.title || "",
      registration_no: u.registration_no || "",
    });
    setMsg("");
    setError("");
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (editForm.role === "student" && !editForm.registration_no.trim()) {
      setError("Registration number is required for students");
      return;
    }
    setBusy(true);
    setMsg("");
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing.id, ...editForm }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not update user");
      return;
    }
    setMsg(`Updated ${data.user.name}`);
    setEditing(null);
    await load();
  }

  async function resetPassword(u: User) {
    if (
      !confirm(
        `Reset password for ${u.name}? They will get the default password and must change it on next login.`
      )
    )
      return;
    setBusy(true);
    setMsg("");
    setError("");
    const res = await fetch("/api/admin/users/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not reset password");
      return;
    }
    setMsg(
      `Password reset for ${u.name}. Default: ${
        data.default_hint || (u.role === "student" ? "their registration number" : "Mnsuam@123")
      }. They must change it on next login.`
    );
  }

  async function removeUser(u: User) {
    if (!confirm(`Remove ${u.name} (${u.email})?`)) return;
    setBusy(true);
    setMsg("");
    setError("");
    const res = await fetch(`/api/admin/users?id=${encodeURIComponent(u.id)}`, { method: "DELETE" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not remove user");
      return;
    }
    setMsg(`Removed ${u.name}`);
    await load();
  }

  async function uploadStudents(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile) {
      setError("Choose an Excel file (.xlsx) first");
      return;
    }
    setImporting(true);
    setMsg("");
    setError("");
    setImportResult(null);
    const body = new FormData();
    body.append("file", importFile);
    const res = await fetch("/api/admin/users/import", { method: "POST", body });
    const data = (await res.json()) as ImportResult;
    setImporting(false);
    if (!res.ok) {
      setError(data.error || "Import failed");
      return;
    }
    setImportResult(data);
    setMsg(
      `Bulk upload: created ${data.created}, skipped ${data.skipped}. New students: password = registration number (must change on first login).`
    );
    setImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await load();
  }

  const deptSelect = (value: string, onChange: (v: string) => void, required = true) => (
    <select
      className="input"
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select department…</option>
      {departments.map((d) => (
        <option key={d.id} value={d.name}>
          {d.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6">
      <form onSubmit={addUser} className="card p-5 space-y-3">
        <h2 className="font-semibold text-navy">Add user</h2>
        <p className="text-xs text-slate-500">
          Default password: students = registration number; others = Mnsuam@123. They must change it
          on first login.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Dr. Ayesha Khan"
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="ayesha@university.edu"
            />
          </div>
          <div>
            <label className="label">Role</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          {form.role === "student" && (
            <div>
              <label className="label">Registration number *</label>
              <input
                className="input"
                required
                value={form.registration_no}
                onChange={(e) => setForm({ ...form, registration_no: e.target.value })}
                placeholder="2026-MS-100"
              />
            </div>
          )}
          <div>
            <label className="label">Department *</label>
            {deptSelect(form.department, (v) => setForm({ ...form, department: v }))}
            {departments.length === 0 && (
              <p className="text-xs text-amber-700 mt-1">
                No departments yet — add some under Admin → Departments.
              </p>
            )}
          </div>
          <div>
            <label className="label">Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Assistant Professor / MS Student"
            />
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={busy || importing}>
          {busy ? "Saving…" : "Add user"}
        </button>
      </form>

      {editing && (
        <form onSubmit={saveEdit} className="card p-5 space-y-3 border-teal-300">
          <h2 className="font-semibold text-navy">Edit user — {editing.email}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                required
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                required
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Role</label>
              <select
                className="input"
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {editForm.role === "student" && (
              <div>
                <label className="label">Registration number *</label>
                <input
                  className="input"
                  required
                  value={editForm.registration_no}
                  onChange={(e) => setEditForm({ ...editForm, registration_no: e.target.value })}
                />
              </div>
            )}
            <div>
              <label className="label">Department *</label>
              {deptSelect(editForm.department, (v) => setEditForm({ ...editForm, department: v }))}
            </div>
            <div>
              <label className="label">Title</label>
              <input
                className="input"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              Save changes
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <form onSubmit={uploadStudents} className="card p-5 space-y-3">
        <h2 className="font-semibold text-navy">Bulk upload students</h2>
        <p className="text-sm text-slate-600">
          Upload an Excel file (.xlsx) to create many student accounts at once. Existing emails or
          registration numbers are skipped. Department must match an existing department name
          (case-insensitive). Initial password = registration number.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/admin/users/import-template"
            className="btn-secondary text-sm"
            download="tms-students-template.xlsx"
          >
            Download template
          </a>
          <span className="text-xs text-slate-500">
            Sheet 1: registration_no*, name, email, department, title — Sheet 2: valid Departments
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Excel file</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="input"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={importing || busy || !importFile}>
            {importing ? "Uploading…" : "Upload"}
          </button>
        </div>
        {importResult && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm space-y-2">
            <p>
              Created <strong>{importResult.created}</strong>, skipped{" "}
              <strong>{importResult.skipped}</strong>
              {importResult.errors?.length ? `, ${importResult.errors.length} issue(s)` : ""}
            </p>
            {importResult.errors?.length > 0 && (
              <ul className="max-h-40 overflow-y-auto text-xs text-slate-700 space-y-1">
                {importResult.errors.map((err, i) => (
                  <li key={`${err.row}-${err.email ?? ""}-${i}`}>
                    Row {err.row}
                    {err.email ? ` (${err.email})` : ""}: {err.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>

      {msg && <p className="text-sm text-teal-700 bg-teal-50 rounded px-3 py-2">{msg}</p>}
      {error && <p className="text-sm text-rose-700 bg-rose-50 rounded px-3 py-2">{error}</p>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-2 p-4 border-b bg-slate-50">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs ${
                filter === f.value ? "bg-teal-700 text-white" : "bg-white border text-slate-600"
              }`}
            >
              {f.label}
              {f.value === "all"
                ? ` (${users.length})`
                : ` (${users.filter((u) => u.role === f.value).length})`}
            </button>
          ))}
        </div>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No users in this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Reg No</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                      {u.registration_no || "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-navy">{u.name}</td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize">
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.department || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{u.title || "—"}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        disabled={busy || importing}
                        onClick={() => startEdit(u)}
                        className="text-xs text-teal-700 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy || importing}
                        onClick={() => resetPassword(u)}
                        className="text-xs text-amber-700 hover:underline"
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        disabled={busy || importing}
                        onClick={() => removeUser(u)}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Removal is blocked while a user is linked to ideas, projects, GEC seats, or interests. Reset
        password sets the default rule and forces change on next login (admin never sees passwords).
      </p>
    </div>
  );
}
