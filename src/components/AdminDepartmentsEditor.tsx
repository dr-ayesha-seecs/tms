"use client";

import { useEffect, useState } from "react";
import type { Department } from "@/lib/types";

export function AdminDepartmentsEditor() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function load() {
    setError("");
    const res = await fetch("/api/admin/departments");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load departments");
      return;
    }
    setDepartments(data.departments || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch("/api/admin/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not add");
      return;
    }
    setName("");
    setMsg(`Added ${data.department.name}`);
    await load();
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch("/api/admin/departments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: editName }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not rename");
      return;
    }
    setEditingId(null);
    setMsg(`Renamed to ${data.department.name}`);
    await load();
  }

  async function remove(d: Department) {
    if (!confirm(`Delete department "${d.name}"?`)) return;
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch(`/api/admin/departments?id=${encodeURIComponent(d.id)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not delete");
      return;
    }
    setMsg(`Deleted ${d.name}`);
    await load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="card p-5 space-y-3">
        <h2 className="font-semibold text-navy">Add department</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Name</label>
            <input
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Computer Science"
            />
          </div>
          <button className="btn-primary" disabled={busy} type="submit">
            Add
          </button>
        </div>
      </form>

      {msg && <p className="text-sm text-teal-700 bg-teal-50 rounded px-3 py-2">{msg}</p>}
      {error && <p className="text-sm text-rose-700 bg-rose-50 rounded px-3 py-2">{error}</p>}

      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b bg-slate-50 text-xs font-semibold uppercase text-slate-500">
          Departments ({departments.length})
        </div>
        {departments.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No departments yet.</p>
        ) : (
          <ul className="divide-y">
            {departments.map((d) => (
              <li key={d.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                {editingId === d.id ? (
                  <div className="flex flex-wrap gap-2 flex-1">
                    <input
                      className="input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <button className="btn-primary text-xs" disabled={busy} type="button" onClick={() => saveEdit(d.id)}>
                      Save
                    </button>
                    <button className="btn-secondary text-xs" type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium text-navy">{d.name}</span>
                    <div className="flex gap-2">
                      <button
                        className="text-xs text-teal-700 hover:underline"
                        type="button"
                        onClick={() => {
                          setEditingId(d.id);
                          setEditName(d.name);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="text-xs text-rose-600 hover:underline"
                        type="button"
                        disabled={busy}
                        onClick={() => remove(d)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Delete is blocked while users still reference the department. Rename updates those users
        automatically.
      </p>
    </div>
  );
}
