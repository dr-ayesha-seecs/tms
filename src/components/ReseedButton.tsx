"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReseedButton() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function reseed() {
    if (
      !confirm(
        "Wipe the database and re-seed default users + form templates? Ideas and projects will be removed (seed no longer creates demo ones)."
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch("/api/seed", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg(data.error || "Failed");
      return;
    }
    setMsg("Re-seeded users and form templates. Sign in again if session user id changed.");
    router.refresh();
  }

  return (
    <div>
      <button className="btn-danger text-sm" disabled={busy} onClick={reseed}>
        Re-seed database
      </button>
      {msg && <p className="text-xs text-slate-500 mt-2">{msg}</p>}
    </div>
  );
}
