"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ChangePasswordForm({ forced }: { forced?: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirm,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not change password");
      return;
    }
    setMsg("Password updated");
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    if (forced) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-5 space-y-3">
      {error && <p className="text-sm text-rose-700 bg-rose-50 rounded px-3 py-2">{error}</p>}
      {msg && <p className="text-sm text-teal-700 bg-teal-50 rounded px-3 py-2">{msg}</p>}
      <div>
        <label className="label">Current password</label>
        <input
          className="input"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div>
        <label className="label">New password (min 8 characters)</label>
        <input
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Confirm new password</label>
        <input
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <button className="btn-primary" disabled={busy} type="submit">
        {busy ? "Saving…" : forced ? "Save and continue" : "Update password"}
      </button>
    </form>
  );
}
