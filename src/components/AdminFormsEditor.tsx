"use client";

import { useEffect, useState } from "react";
import type { ProgramType } from "@/lib/types";
import type { FormCategory, FormTemplate } from "@/lib/form-templates";

const CATEGORIES: FormCategory[] = [
  "gec",
  "meeting",
  "proposal",
  "progress",
  "inhouse",
  "final",
  "completion",
  "document",
];

type Row = {
  id?: string;
  code: string;
  display_name: string;
  description: string;
  sort_order: number;
  enabled: boolean;
  requires_esign: boolean;
  category: FormCategory;
};

function toRows(templates: FormTemplate[]): Row[] {
  return templates.map((t) => ({
    id: t.id,
    code: t.code,
    display_name: t.display_name,
    description: t.description || "",
    sort_order: t.sort_order,
    enabled: !!t.enabled,
    requires_esign: !!t.requires_esign,
    category: t.category,
  }));
}

export function AdminFormsEditor({ initialProgram }: { initialProgram?: ProgramType }) {
  const [program, setProgram] = useState<ProgramType>(initialProgram || "MS_THESIS");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function load(p: ProgramType) {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/admin/form-templates?program=${p}`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Failed to load");
      return;
    }
    setRows(toRows(data.templates));
  }

  useEffect(() => {
    load(program);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program]);

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function move(i: number, dir: -1 | 1) {
    setRows((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((r, idx) => ({ ...r, sort_order: (idx + 1) * 10 }));
    });
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        code: `custom_${Date.now().toString(36)}`,
        display_name: "New form",
        description: "",
        sort_order: (prev.length + 1) * 10,
        enabled: true,
        requires_esign: true,
        category: "document",
      },
    ]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    setMsg("");
    setError("");
    const res = await fetch("/api/admin/form-templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        program,
        templates: rows.map((r, i) => ({
          ...r,
          sort_order: r.sort_order || (i + 1) * 10,
        })),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Save failed");
      return;
    }
    setRows(toRows(data.templates));
    setMsg("Saved.");
  }

  async function reset() {
    if (!confirm(`Reset ${program === "FYP" ? "FYP" : "MS Thesis"} forms to defaults?`)) return;
    setSaving(true);
    const res = await fetch("/api/admin/form-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", program }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Reset failed");
      return;
    }
    setRows(toRows(data.templates));
    setMsg("Reset to defaults.");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          className={`btn ${program === "MS_THESIS" ? "btn-navy" : "btn-secondary"}`}
          onClick={() => setProgram("MS_THESIS")}
        >
          MS Thesis
        </button>
        <button
          className={`btn ${program === "FYP" ? "btn-navy" : "btn-secondary"}`}
          onClick={() => setProgram("FYP")}
        >
          FYP
        </button>
      </div>

      <p className="text-sm text-slate-600">
        Editing <strong>{program === "FYP" ? "Final Year Project" : "MS Thesis"}</strong> form
        labels. The <code className="text-xs bg-slate-100 px-1 rounded">code</code> is the stable
        workflow key used by the app; change <strong>display name</strong> to match your institution.
      </p>

      {error && <div className="rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-sm">{error}</div>}
      {msg && <div className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">{msg}</div>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.id || r.code + i} className="card p-4 space-y-2">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <span className="text-xs font-mono text-slate-400">#{i + 1}</span>
                <div className="flex gap-1">
                  <button type="button" className="btn-secondary text-xs" onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button type="button" className="btn-danger text-xs" onClick={() => removeRow(i)}>
                    Remove
                  </button>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <div>
                  <label className="label">Code (stable)</label>
                  <input
                    className="input font-mono text-xs"
                    value={r.code}
                    onChange={(e) => update(i, { code: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-1 lg:col-span-2">
                  <label className="label">Display name</label>
                  <input
                    className="input"
                    value={r.display_name}
                    onChange={(e) => update(i, { display_name: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="label">Description</label>
                  <input
                    className="input"
                    value={r.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Category</label>
                  <select
                    className="input"
                    value={r.category}
                    onChange={(e) => update(i, { category: e.target.value as FormCategory })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Order</label>
                  <input
                    className="input"
                    type="number"
                    value={r.sort_order}
                    onChange={(e) => update(i, { sort_order: Number(e.target.value) })}
                  />
                </div>
                <div className="flex items-end gap-4 pb-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => update(i, { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={r.requires_esign}
                      onChange={(e) => update(i, { requires_esign: e.target.checked })}
                    />
                    Requires e-sign
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 sticky bottom-4 bg-white/90 backdrop-blur border rounded-xl p-3 shadow">
        <button className="btn-secondary" type="button" onClick={addRow}>
          + Add form
        </button>
        <button className="btn-primary" type="button" disabled={saving} onClick={save}>
          Save {program === "FYP" ? "FYP" : "MS"} forms
        </button>
        <button className="btn-secondary" type="button" disabled={saving} onClick={reset}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
