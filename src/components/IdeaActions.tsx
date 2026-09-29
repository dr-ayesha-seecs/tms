"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "./StatusBadge";
import { formatDate } from "@/lib/format";

type Interest = {
  id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  student_registration_no?: string | null;
  statement: string | null;
  status: string;
  created_at: string;
};

type PoolUser = { id: string; name: string; role: string; title: string | null };

export function IdeaActions({
  ideaId,
  ideaStatus,
  isOwner,
  isStudent,
  isAdmin,
  myInterestId,
  myInterestStatus,
  interests,
  facultyPool,
  placesLeft = 3,
}: {
  ideaId: string;
  ideaStatus: string;
  isOwner: boolean;
  isStudent: boolean;
  isAdmin?: boolean;
  myInterestId?: string;
  myInterestStatus?: string;
  interests: Interest[];
  facultyPool: PoolUser[];
  /** Places still free on this idea (slots − students already on its projects). */
  placesLeft?: number;
}) {
  const maxGroup = Math.max(0, Math.min(3, placesLeft));
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [editStatement, setEditStatement] = useState("");
  const [editingInterest, setEditingInterest] = useState(false);
  const [error, setError] = useState("");
  const [acceptId, setAcceptId] = useState<string | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [coSup, setCoSup] = useState("");
  const [internal, setInternal] = useState("");
  const [external, setExternal] = useState("");
  const [busy, setBusy] = useState(false);

  const pending = useMemo(
    () => interests.filter((i) => i.status === "pending"),
    [interests]
  );

  async function expressInterest() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/interests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea_id: ideaId, statement }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    router.refresh();
  }

  async function saveStatement() {
    if (!myInterestId) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/interests/${myInterestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement: editStatement }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    setEditingInterest(false);
    router.refresh();
  }

  async function withdraw() {
    if (!myInterestId) return;
    if (!confirm("Withdraw your interest in this idea?")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/interests/${myInterestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "withdraw" }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    router.refresh();
  }

  async function decide(interestId: string, action: "accept" | "reject") {
    setBusy(true);
    setError("");
    const gec_invites = [];
    const primary = interests.find((i) => i.id === interestId);
    let student_ids: string[] | undefined;
    if (action === "accept") {
      if (coSup) gec_invites.push({ user_id: coSup, gec_role: "co_supervisor" });
      if (internal) gec_invites.push({ user_id: internal, gec_role: "internal_examiner" });
      if (external) gec_invites.push({ user_id: external, gec_role: "external_examiner" });
      const selected = groupIds.length
        ? groupIds
        : primary
          ? [primary.student_id]
          : [];
      if (maxGroup < 1) {
        setBusy(false);
        setError("All places on this idea are filled. Increase the group size or free a place first.");
        return;
      }
      if (selected.length < 1 || selected.length > maxGroup) {
        setBusy(false);
        setError(`Select 1 to ${maxGroup} student${maxGroup === 1 ? "" : "s"} for the project group`);
        return;
      }
      student_ids = selected;
    }
    const res = await fetch(`/api/interests/${interestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, gec_invites, student_ids }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    if (data.project_id) {
      router.push(`/projects/${data.project_id}`);
    } else {
      router.refresh();
    }
  }

  async function adminDeleteInterest(interestId: string) {
    if (!confirm("Permanently delete this interest record? (Admin only)")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/interests/${interestId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed");
      return;
    }
    router.refresh();
  }

  function openAccept(interest: Interest) {
    setAcceptId(interest.id);
    setGroupIds([interest.student_id]);
  }

  function toggleGroupMember(studentId: string) {
    setGroupIds((prev) => {
      if (prev.includes(studentId)) {
        if (prev.length <= 1) return prev; // keep at least the primary
        return prev.filter((id) => id !== studentId);
      }
      if (prev.length >= maxGroup) return prev;
      return [...prev, studentId];
    });
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-sm">{error}</div>}

      {isStudent && !myInterestStatus && ideaStatus !== "converted" && ideaStatus !== "closed" && (
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold text-navy">Express interest</h3>
          <p className="text-xs text-slate-500">
            Projects may include a group of up to 3 students.
          </p>
          <textarea
            className="input min-h-[80px]"
            placeholder="Optional statement of interest"
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
          <button className="btn-primary" disabled={busy} onClick={expressInterest}>
            Submit interest
          </button>
        </div>
      )}

      {isStudent && myInterestStatus && (
        <div className="card p-4 text-sm space-y-3">
          <div>
            Your interest status: <StatusBadge status={myInterestStatus} />
          </div>
          {myInterestStatus === "pending" && (
            <div className="flex flex-wrap gap-2">
              {!editingInterest ? (
                <>
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => {
                      const mine = interests.find((i) => i.id === myInterestId);
                      setEditStatement(mine?.statement || "");
                      setEditingInterest(true);
                    }}
                  >
                    Edit statement
                  </button>
                  <button className="btn-secondary text-xs" disabled={busy} onClick={withdraw}>
                    Withdraw interest
                  </button>
                </>
              ) : (
                <div className="w-full space-y-2">
                  <textarea
                    className="input min-h-[70px]"
                    value={editStatement}
                    onChange={(e) => setEditStatement(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button className="btn-primary text-xs" disabled={busy} onClick={saveStatement}>
                      Save
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => setEditingInterest(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card p-5">
        <h3 className="font-semibold text-navy mb-3">Interests ({interests.length})</h3>
        <div className="space-y-3">
          {interests.length === 0 && <p className="text-sm text-slate-500">No interests yet.</p>}
          {interests.map((i) => (
            <div key={i.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="font-medium">{i.student_name}</div>
                  <div className="text-xs text-slate-500">
                    {i.student_registration_no ? `${i.student_registration_no} · ` : ""}
                    {i.student_email}
                  </div>
                </div>
                <StatusBadge status={i.status} />
              </div>
              {i.statement && <p className="mt-2 text-sm text-slate-600">{i.statement}</p>}
              <div className="text-xs text-slate-400 mt-1">{formatDate(i.created_at)}</div>

              {isOwner && i.status === "pending" && (
                <div className="mt-3 space-y-2">
                  {acceptId === i.id ? (
                    <div className="rounded-lg bg-slate-50 p-3 space-y-2">
                      <p className="text-xs font-medium text-slate-700">
                        Project group (1–{Math.max(1, maxGroup)} student{maxGroup === 1 ? "" : "s"} who expressed interest · {placesLeft} place{placesLeft === 1 ? "" : "s"} free)
                      </p>
                      <div className="space-y-1">
                        {pending.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={groupIds.includes(p.student_id)}
                              disabled={
                                (!groupIds.includes(p.student_id) && groupIds.length >= maxGroup) ||
                                (groupIds.length === 1 && groupIds[0] === p.student_id)
                              }
                              onChange={() => toggleGroupMember(p.student_id)}
                            />
                            <span>
                              {p.student_name}
                              {p.student_registration_no ? ` (${p.student_registration_no})` : ""}
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500">{groupIds.length}/{Math.max(1, maxGroup)} selected</p>
                      <p className="text-xs text-slate-600">Invite GEC members (optional now; can add later):</p>
                      <select className="input" value={coSup} onChange={(e) => setCoSup(e.target.value)}>
                        <option value="">Co-supervisor…</option>
                        {facultyPool.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.role})
                          </option>
                        ))}
                      </select>
                      <select className="input" value={internal} onChange={(e) => setInternal(e.target.value)}>
                        <option value="">Internal examiner…</option>
                        {facultyPool
                          .filter((u) => u.role === "faculty")
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                      <select className="input" value={external} onChange={(e) => setExternal(e.target.value)}>
                        <option value="">External examiner…</option>
                        {facultyPool.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.role})
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          className="btn-primary text-xs"
                          disabled={busy}
                          onClick={() => decide(i.id, "accept")}
                        >
                          Accept group & create project
                        </button>
                        <button className="btn-secondary text-xs" onClick={() => setAcceptId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button className="btn-primary text-xs" onClick={() => openAccept(i)}>
                        Accept into project
                      </button>
                      <button
                        className="btn-danger text-xs"
                        disabled={busy}
                        onClick={() => decide(i.id, "reject")}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isAdmin && (
                <button
                  className="btn-danger text-xs mt-2"
                  disabled={busy}
                  onClick={() => adminDeleteInterest(i.id)}
                >
                  Delete interest
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
