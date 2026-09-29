"use client";

import { useState } from "react";

export function ClearIdeasProjectsButton() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function clearAll() {
    if (
      !confirm(
        "Clear ALL ideas and projects (and related meetings, forms, documents, signatures, GEC)? Users, form templates and the activity log will be kept."
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/clear-ideas-projects", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setMsg(data.error || "Failed");
        return;
      }
      setMsg(
        `Cleared. Ideas: ${data.counts?.ideas ?? 0}, projects: ${data.counts?.projects ?? 0}. Redirecting…`
      );
      // Hard navigation so RSC cannot show a stale cached snapshot
      window.location.href = "/ideas?cleared=1";
    } catch (e) {
      setBusy(false);
      setMsg(e instanceof Error ? e.message : "Network error");
    }
  }

  return (
    <div>
      <button className="btn-danger text-sm" disabled={busy} onClick={clearAll}>
        {busy ? "Clearing…" : "Clear all ideas & projects"}
      </button>
      {msg && <p className="text-xs text-slate-500 mt-2">{msg}</p>}
    </div>
  );
}
