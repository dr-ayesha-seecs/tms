"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EditIdeaPanel({
  idea,
  canEdit,
  isAdmin,
}: {
  idea: {
    id: string;
    title: string;
    abstract: string;
    domain: string;
    slots: number;
    status: string;
    program_type: string;
  };
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(idea.title);
  const [abstract, setAbstract] = useState(idea.abstract);
  const [domain, setDomain] = useState(idea.domain);
  const [slots, setSlots] = useState(Math.min(3, Math.max(1, idea.slots || 1)));
  const [programType, setProgramType] = useState(idea.program_type || "MS_THESIS");
  const [status, setStatus] = useState(idea.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  if (!canEdit && !isAdmin) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch(`/api/ideas/${idea.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        abstract,
        domain,
        slots,
        program_type: programType,
        status,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed to save");
      return;
    }
    setMsg("Saved");
    setOpen(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Permanently delete this idea and its interests? (Admin only)")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/ideas/${idea.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Delete failed");
      return;
    }
    router.push("/ideas");
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <button className="btn-secondary text-xs" onClick={() => setOpen(true)}>
            Edit idea
          </button>
        )}
        {isAdmin && (
          <button className="btn-danger text-xs" disabled={busy} onClick={remove}>
            Delete idea
          </button>
        )}
        {msg && <span className="text-xs text-teal-700">{msg}</span>}
        {error && <span className="text-xs text-rose-700">{error}</span>}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="card p-4 space-y-3">
      <h3 className="font-semibold text-navy">Edit idea</h3>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div>
        <label className="label">Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div>
        <label className="label">Domain</label>
        <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} required />
      </div>
      <div>
        <label className="label">Abstract</label>
        <textarea
          className="input min-h-[90px]"
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          required
        />
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Program</label>
          <select
            className="input"
            value={programType}
            onChange={(e) => setProgramType(e.target.value)}
          >
            <option value="FYP">Undergraduate (FYP)</option>
            <option value="MS_THESIS">Postgraduate (MS)</option>
          </select>
        </div>
        <div>
          <label className="label">Group size (max 3)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={3}
            value={slots}
            onChange={(e) => setSlots(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">open</option>
            <option value="interest_pending">interest_pending</option>
            <option value="gec_forming">gec_forming</option>
            <option value="converted">converted</option>
            <option value="closed">closed</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
