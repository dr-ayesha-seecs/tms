"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateIdeaForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [domain, setDomain] = useState("");
  const [slots, setSlots] = useState(1);
  const [programType, setProgramType] = useState<"FYP" | "MS_THESIS">("MS_THESIS");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, abstract, domain, slots, program_type: programType }),
      });
      let data: { error?: string; idea?: { id: string } } = {};
      try {
        data = await res.json();
      } catch {
        data = { error: res.ok ? "Invalid response from server" : `Request failed (${res.status})` };
      }
      if (!res.ok) {
        setError(data.error || `Failed to publish idea (${res.status})`);
        return;
      }
      if (!data.idea?.id) {
        setError("Idea was created but no id was returned. Refresh the ideas list.");
        return;
      }
      setOpen(false);
      setTitle("");
      setAbstract("");
      setDomain("");
      setSlots(1);
      setProgramType("MS_THESIS");
      router.push(`/ideas/${data.idea.id}`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error while publishing";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Float new idea
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-3">
      <h3 className="font-semibold text-navy">New research idea</h3>
      {error && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
          {error}
        </p>
      )}
      <div>
        <label className="label">Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div>
        <label className="label">Domain</label>
        <input
          className="input"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          required
          placeholder="e.g. NLP / Cybersecurity"
        />
      </div>
      <div>
        <label className="label">Abstract</label>
        <textarea
          className="input min-h-[100px]"
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          required
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">This idea is for</label>
          <select
            className="input"
            value={programType}
            onChange={(e) => setProgramType(e.target.value as "FYP" | "MS_THESIS")}
            required
          >
            <option value="FYP">Undergraduate (FYP)</option>
            <option value="MS_THESIS">Postgraduate (MS / MPhil)</option>
          </select>
        </div>
        <div>
          <label className="label">Group size (max 3)</label>
          <input
            className="input w-28"
            type="number"
            min={1}
            max={3}
            value={slots}
            onChange={(e) => setSlots(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy} type="submit">
          {busy ? "Publishing…" : "Publish idea"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
