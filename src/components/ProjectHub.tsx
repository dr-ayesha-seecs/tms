"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User, Project, GecMember, Meeting, Milestone, Defence, Document, FormRecord, Signature, Activity } from "@/lib/types";
import type { FormTemplate } from "@/lib/form-templates";
import { FORM_CODES } from "@/lib/form-templates";
import { StatusBadge } from "./StatusBadge";
import { ProgramBadge } from "./ProgramBadge";
import { StatusPipeline } from "./StatusPipeline";
import { SignaturePad } from "./SignaturePad";
import { SignatureList } from "./SignatureList";
import { formatDate, formatDateShort } from "@/lib/format";
import { localInputToPktIso } from "@/lib/pkt";
import { assignableGecRoles, isPostgraduateProgram, roleLabelForGec } from "@/lib/gec-roles";

type DocWithSig = Document & { uploader_name?: string; signatures: (Signature & { user_name?: string })[] };
type FormWithSig = FormRecord & { display_name?: string; signatures: (Signature & { user_name?: string })[] };
type GecRow = GecMember & { user_name?: string; user_email?: string; user_title?: string };
type Act = Activity & { actor_name?: string };

const TABS = ["Overview", "Progress", "Meetings", "Defences", "Documents", "GEC & Signatures"] as const;

export function ProjectHub({
  user,
  project,
  gec,
  meetings,
  milestones,
  defences,
  documents,
  forms,
  activity,
  facultyPool,
  formTemplates = [],
  students = [],
  initialTab,
}: {
  user: User;
  project: Project;
  gec: GecRow[];
  meetings: Meeting[];
  milestones: Milestone[];
  defences: Defence[];
  documents: DocWithSig[];
  forms: FormWithSig[];
  activity: Act[];
  facultyPool: User[];
  formTemplates?: FormTemplate[];
  students?: {
    student_id: string;
    name: string;
    email: string;
    registration_no: string | null;
  }[];
  initialTab?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>(
    (TABS as readonly string[]).includes(initialTab || "") ? (initialTab as (typeof TABS)[number]) : "Overview"
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signTarget, setSignTarget] = useState<{ type: "form" | "document"; id: string } | null>(null);
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [groupDraft, setGroupDraft] = useState<string[]>([]);
  const [studentPool, setStudentPool] = useState<
    { id: string; name: string; registration_no: string | null; email: string }[]
  >([]);

  const isSupervisor = user.id === project.supervisor_id || user.role === "admin";
  const isMember =
    user.id === project.student_id ||
    (students || []).some((s) => s.student_id === user.id);
  const isAdmin = user.role === "admin";
  const isGec = gec.some((g) => g.user_id === user.id);
  const th1 = forms.find((f) => f.form_type === FORM_CODES.GEC_FORMATION);
  const th1Signed = th1?.status === "signed" || th1?.status === "approved";

  const pendingRolesFor = (sigs: (Signature & { user_name?: string })[]) => {
    const signedUsers = new Set(sigs.map((s) => s.user_id));
    return gec.filter((g) => !signedUsers.has(g.user_id)).map((g) => `${g.user_name} (${roleLabelForGec(g.gec_role)})`);
  };

  async function api(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Request failed");
      return null;
    }
    router.refresh();
    return data;
  }

  async function sign(payload: { method: "typed" | "canvas"; signature_data: string }) {
    if (!signTarget) return;
    await api("/api/signatures", "POST", {
      target_type: signTarget.type,
      target_id: signTarget.id,
      project_id: project.id,
      ...payload,
    });
    setSignTarget(null);
  }

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-navy">{project.title}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {students && students.length > 1
                ? students.map((s) => s.name).join(", ")
                : project.student_name}{students && students.length > 1
                  ? ` (${students.map((s) => s.registration_no || "?").join(", ")})`
                  : project.student_registration_no
                    ? ` (${project.student_registration_no})`
                    : ""} · Supervisor {project.supervisor_name} · {project.domain}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={project.status} />
            <span className="text-xs text-slate-500 capitalize">{project.stage.replace(/_/g, " ")}</span>
            {project.acb_approved ? <span className="badge-teal">ACB approved</span> : <span className="badge-warning">ACB pending</span>}
            <ProgramBadge programType={project.program_type} />
          </div>
        </div>
        <StatusPipeline stage={project.stage} status={project.status} />
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Overall progress</span>
            <span>{project.progress_pct}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-teal-600 transition-all" style={{ width: `${project.progress_pct}%` }} />
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg bg-rose-50 text-rose-700 px-3 py-2 text-sm">{error}</div>}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-px">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? "border-teal-700 text-teal-800" : "border-transparent text-slate-500 hover:text-navy"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-navy">Abstract</h3>
            <p className="text-sm text-slate-600">{project.abstract}</p>
            {isSupervisor && (
              <div className="flex flex-wrap gap-2 pt-2">
                <button className="btn-secondary text-xs" disabled={busy} onClick={() => api(`/api/projects/${project.id}/advance`, "POST", { action: "finalize_gec" })}>
                  Finalize GEC
                </button>
                <button className="btn-primary text-xs" disabled={busy || !th1Signed} title={!th1Signed ? "Formation form must be signed" : ""} onClick={() => api(`/api/projects/${project.id}/advance`, "POST", { action: "simulate_acb" })}>
                  Simulate ACB approval
                </button>
                <button className="btn-secondary text-xs" disabled={busy} onClick={() => api(`/api/projects/${project.id}/advance`, "POST", { action: "complete" })}>
                  Mark complete (needs TH-4)
                </button>
              
                {user.role === "admin" && (
                  <button
                    className="btn-danger text-xs"
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm("Permanently delete this project and all related records?")) return;
                      await api(`/api/projects/${project.id}`, "DELETE");
                      router.push("/projects");
                    }}
                  >
                    Delete project
                  </button>
                )}
                {isSupervisor && (
                  <button
                    className="btn-secondary text-xs"
                    disabled={busy}
                    onClick={async () => {
                      const title = prompt("Project title", project.title);
                      if (title == null || !title.trim()) return;
                      const abstract = prompt("Abstract", project.abstract || "");
                      if (abstract == null) return;
                      await api(`/api/projects/${project.id}`, "PATCH", {
                        title: title.trim(),
                        abstract,
                      });
                    }}
                  >
                    Edit project
                  </button>
                )}
                {isSupervisor && (
                  <button
                    className="btn-secondary text-xs"
                    disabled={busy}
                    onClick={async () => {
                      setGroupDraft((students || []).map((s) => s.student_id));
                      setShowGroupEditor(true);
                      try {
                        const res = await fetch("/api/users");
                        const data = await res.json();
                        const pool = (data.users || data || []).filter(
                          (u: { role: string }) => u.role === "student"
                        );
                        setStudentPool(pool);
                      } catch {
                        setStudentPool([]);
                      }
                    }}
                  >
                    Edit group members
                  </button>
                )}
</div>
            )}
          </div>
          <div className="card p-5">
            <h3 className="font-semibold text-navy mb-3">Recent activity</h3>
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {activity.map((a) => (
                <li key={a.id} className="text-sm border-b border-slate-50 pb-2">
                  <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
                  <div className="text-xs text-slate-500">{a.actor_name} · {formatDate(a.created_at)}</div>
                  {a.detail && <div className="text-xs text-slate-600">{a.detail}</div>}
                </li>
              ))}
            </ul>
          </div>
          <FormsPanel
            projectId={project.id}
            forms={forms}
            th1Signed={!!th1Signed}
            isSupervisor={isSupervisor}
            isGec={isGec}
            busy={busy}
            user={user}
            formTemplates={formTemplates}
            gecLabel={formTemplates.find((t) => t.code === FORM_CODES.GEC_FORMATION)?.display_name || "GEC / panel formation"}
            pendingRolesFor={pendingRolesFor}
            onCreate={(form_type, payload) => api(`/api/projects/${project.id}/forms`, "POST", { form_type, payload })}
            onSign={(id) => setSignTarget({ type: "form", id })}
          />
        </div>
      )}

      {tab === "Progress" && (
        <ProgressPanel
          projectId={project.id}
          milestones={milestones}
          canEdit={isSupervisor || isMember}
          isAdmin={isAdmin}
          busy={busy}
          onAdd={(body) => api(`/api/projects/${project.id}/milestones`, "POST", body)}
          onUpdate={(body) => api(`/api/projects/${project.id}/milestones`, "PATCH", body)}
          onDelete={async (milestoneId) => {
            if (!confirm("Delete this milestone? (Admin only)")) return;
            await api(`/api/projects/${project.id}/milestones?milestone_id=${encodeURIComponent(milestoneId)}`, "DELETE");
          }}
        />
      )}

      {tab === "Meetings" && (
        <MeetingsPanel
          meetings={meetings}
          canAdd={isSupervisor || isMember || isGec}
          canEdit={isSupervisor || isMember}
          isAdmin={isAdmin}
          busy={busy}
          onAdd={(body) => api(`/api/projects/${project.id}/meetings`, "POST", body)}
          onUpdate={(body) => api(`/api/projects/${project.id}/meetings`, "PATCH", body)}
          onDelete={async (meetingId) => {
            if (!confirm("Delete this meeting? (Admin only)")) return;
            await api(`/api/projects/${project.id}/meetings?meeting_id=${encodeURIComponent(meetingId)}`, "DELETE");
          }}
        />
      )}

      {tab === "Defences" && (
        <DefencesPanel
          defences={defences}
          th1Signed={!!th1Signed}
          isSupervisor={isSupervisor}
          isAdmin={isAdmin}
          busy={busy}
          onResult={(body) => api(`/api/projects/${project.id}/defences`, "PATCH", body)}
          onDelete={async (defenceId) => {
            if (!confirm("Delete this defence record? (Admin only)")) return;
            await api(`/api/projects/${project.id}/defences?defence_id=${encodeURIComponent(defenceId)}`, "DELETE");
          }}
        />
      )}

      {tab === "Documents" && (
        <DocumentsPanel
          documents={documents}
          gec={gec}
          canUpload={isSupervisor || isMember || isGec}
          canEdit={isSupervisor || isMember}
          isAdmin={isAdmin}
          busy={busy}
          user={user}
          pendingRolesFor={pendingRolesFor}
          onUpload={(body) => api(`/api/projects/${project.id}/documents`, "POST", body)}
          onUpdate={(body) => api(`/api/projects/${project.id}/documents`, "PATCH", body)}
          onDelete={async (documentId) => {
            if (!confirm("Delete this document? (Admin only)")) return;
            await api(`/api/projects/${project.id}/documents?document_id=${encodeURIComponent(documentId)}`, "DELETE");
          }}
          onSign={(id) => setSignTarget({ type: "document", id })}
        />
      )}

      {tab === "GEC & Signatures" && (
        <GecPanel
          projectId={project.id}
          gec={gec}
          forms={forms}
          documents={documents}
          facultyPool={facultyPool}
          isSupervisor={isSupervisor}
          isAdmin={isAdmin}
          user={user}
          busy={busy}
          onInvite={(body) => api(`/api/projects/${project.id}/gec`, "POST", body)}
          onAccept={() => api(`/api/projects/${project.id}/gec`, "PATCH", { action: "accept" })}
          onUpdateRole={(body) => api(`/api/projects/${project.id}/gec`, "PATCH", body)}
          onDelete={async (memberId) => {
            if (!confirm("Remove this GEC member? (Admin only)")) return;
            await api(`/api/projects/${project.id}/gec?member_id=${encodeURIComponent(memberId)}`, "DELETE");
          }}
          onSignForm={(id) => setSignTarget({ type: "form", id })}
          onSignDoc={(id) => setSignTarget({ type: "document", id })}
          programType={project.program_type}
        />
      )}

      
      {showGroupEditor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-lg p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-navy">Project group (1–3 students)</h3>
              <button className="btn-secondary text-xs" type="button" onClick={() => setShowGroupEditor(false)}>
                Close
              </button>
            </div>
            <p className="text-xs text-slate-500">{groupDraft.length}/3 selected. Members see this project on their dashboard.</p>
            <div className="max-h-64 overflow-y-auto space-y-1 border rounded-lg p-2">
              {studentPool.map((s) => {
                const checked = groupDraft.includes(s.id);
                return (
                  <label key={s.id} className="flex items-center gap-2 text-sm px-1 py-1 hover:bg-slate-50 rounded">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && groupDraft.length >= 3}
                      onChange={() => {
                        setGroupDraft((prev) => {
                          if (prev.includes(s.id)) return prev.filter((id) => id !== s.id);
                          if (prev.length >= 3) return prev;
                          return [...prev, s.id];
                        });
                      }}
                    />
                    <span>
                      {s.name}
                      {(s as { registration_no?: string | null }).registration_no ? ` (${(s as { registration_no?: string | null }).registration_no})` : ""}
                    </span>
                  </label>
                );
              })}
              {!studentPool.length && <p className="text-xs text-slate-500 p-2">Loading students…</p>}
            </div>
            <button
              className="btn-primary"
              disabled={busy || groupDraft.length < 1 || groupDraft.length > 3}
              type="button"
              onClick={async () => {
                setBusy(true);
                setError("");
                const res = await fetch(`/api/projects/${project.id}/students`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ student_ids: groupDraft }),
                });
                const data = await res.json().catch(() => ({}));
                setBusy(false);
                if (!res.ok) {
                  setError(data.error || "Failed to update group");
                  return;
                }
                setShowGroupEditor(false);
                router.refresh();
              }}
            >
              Save group
            </button>
          </div>
        </div>
      )}

      {signTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-lg p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-navy">E-sign {signTarget.type}</h3>
              <button className="btn-secondary text-xs" onClick={() => setSignTarget(null)}>Close</button>
            </div>
            <SignaturePad defaultName={user.name} onSigned={sign} disabled={busy} />
          </div>
        </div>
      )}
    </div>
  );
}

function FormsPanel({
  projectId, forms, th1Signed, isSupervisor, isGec, busy, user, formTemplates, gecLabel, pendingRolesFor, onCreate, onSign,
}: {
  projectId: string;
  forms: FormWithSig[];
  th1Signed: boolean;
  isSupervisor: boolean;
  isGec: boolean;
  busy: boolean;
  user: User;
  formTemplates: FormTemplate[];
  gecLabel: string;
  pendingRolesFor: (s: FormWithSig["signatures"]) => string[];
  onCreate: (t: string, payload: Record<string, unknown>) => Promise<unknown>;
  onSign: (id: string) => void;
}) {
  const enabled = formTemplates.filter((t) => t.enabled);
  const [formType, setFormType] = useState(enabled[0]?.code || FORM_CODES.GEC_FORMATION);
  const [venue, setVenue] = useState("Seminar Hall A");
  const [scheduled, setScheduled] = useState("");
  const [result, setResult] = useState("pass");

  const selected = enabled.find((t) => t.code === formType);
  const needsSchedule = ["proposal", "inhouse", "final", "progress"].includes(selected?.category || "");
  const isResultForm = formType === FORM_CODES.PROPOSAL_RESULT;

  async function create() {
    const payload: Record<string, unknown> = {};
    if (needsSchedule && !isResultForm) {
      payload.venue = venue;
      payload.scheduled_at = scheduled ? localInputToPktIso(scheduled) : new Date(Date.now() + 7 * 86400000).toISOString();
    }
    if (isResultForm) {
      payload.result = result;
      payload.comments = "Recorded via demo form";
    }
    if (formType === FORM_CODES.COMPLETION) {
      payload.clearance_notes = "All requirements met (demo)";
    }
    await onCreate(formType, payload);
  }

  function labelFor(code: string, fallback?: string) {
    return formTemplates.find((t) => t.code === code)?.display_name || fallback || code;
  }

  return (
    <div className="card p-5 lg:col-span-2 space-y-4">
      <h3 className="font-semibold text-navy">Electronic forms</h3>
      <p className="text-xs text-slate-500">
        Labels come from Admin → Form name settings for this program track.
      </p>
      {!th1Signed && formType !== FORM_CODES.GEC_FORMATION && formType !== FORM_CODES.GEC_CHANGE && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
          “{gecLabel}” must be fully signed before other forms.
        </p>
      )}
      {(isSupervisor || isGec) && (
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="label">Form</label>
            <select className="input min-w-[220px]" value={formType} onChange={(e) => setFormType(e.target.value)}>
              {enabled.map((f) => (
                <option key={f.code} value={f.code}>{f.display_name}</option>
              ))}
            </select>
          </div>
          {needsSchedule && !isResultForm && (
            <>
              <div>
                <label className="label">Schedule (PKT)</label>
                <input className="input" type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
              </div>
              <div>
                <label className="label">Venue</label>
                <input className="input" value={venue} onChange={(e) => setVenue(e.target.value)} />
              </div>
            </>
          )}
          {isResultForm && (
            <div>
              <label className="label">Result</label>
              <select className="input" value={result} onChange={(e) => setResult(e.target.value)}>
                <option value="pass">Pass</option>
                <option value="conditional_pass">Conditional pass</option>
                <option value="fail">Fail</option>
              </select>
            </div>
          )}
          <button className="btn-primary" disabled={busy || !enabled.length} onClick={create}>Create form</button>
        </div>
      )}
      <div className="space-y-3">
        {forms.map((f) => {
          const already = f.signatures.some((s) => s.user_id === user.id);
          const name = f.display_name || labelFor(f.form_type);
          return (
            <div key={f.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="font-medium">{name}</div>
                  <div className="text-[11px] font-mono text-slate-400">{f.form_type}</div>
                </div>
                <StatusBadge status={f.status} />
              </div>
              <p className="text-xs text-slate-500 mt-1">{formatDate(f.created_at)}</p>
              <div className="mt-2">
                <SignatureList signatures={f.signatures} pendingRoles={pendingRolesFor(f.signatures)} />
              </div>
              {!already && (isGec || isSupervisor) && f.status !== "signed" && (
                <button className="btn-navy text-xs mt-2" onClick={() => onSign(f.id)}>Sign this form</button>
              )}
            </div>
          );
        })}
        {!forms.length && (
          <p className="text-sm text-slate-500">
            No forms yet. Create “{gecLabel}” after the committee/GEC is invited.
          </p>
        )}
      </div>
      <p className="text-[11px] text-slate-400">Project id: {projectId}</p>
    </div>
  );
}

function ProgressPanel({
  milestones, canEdit, isAdmin, busy, onAdd, onUpdate, onDelete,
}: {
  projectId: string;
  milestones: Milestone[];
  canEdit: boolean;
  isAdmin?: boolean;
  busy: boolean;
  onAdd: (b: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (b: Record<string, unknown>) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  return (
    <div className="card p-5 space-y-4">
      <h3 className="font-semibold text-navy">Milestones</h3>
      {canEdit && (
        <div className="flex gap-2">
          <input className="input" placeholder="New milestone" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button
            className="btn-primary"
            disabled={busy || !title.trim()}
            onClick={async () => {
              await onAdd({ title, status: "pending", progress_pct: 0 });
              setTitle("");
            }}
          >
            Add
          </button>
        </div>
      )}
      <div className="space-y-3">
        {milestones.map((m) => (
          <div key={m.id} className="rounded-lg border border-slate-100 p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div className="font-medium">{m.title}</div>
              <StatusBadge status={m.status} />
            </div>
            {m.description && <p className="text-sm text-slate-600 mt-1">{m.description}</p>}
            <div className="text-xs text-slate-500 mt-1">Due: {formatDateShort(m.due_date)} · {m.progress_pct}%</div>
            <div className="h-1.5 mt-2 rounded bg-slate-100 overflow-hidden">
              <div className="h-full bg-teal-600" style={{ width: `${m.progress_pct}%` }} />
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {canEdit && (
                <>
                  <button className="btn-secondary text-xs" disabled={busy} onClick={() => onUpdate({ milestone_id: m.id, status: "in_progress", progress_pct: Math.max(m.progress_pct, 25) })}>In progress</button>
                  <button className="btn-primary text-xs" disabled={busy} onClick={() => onUpdate({ milestone_id: m.id, status: "done", progress_pct: 100 })}>Done</button>
                  <button
                    className="btn-secondary text-xs"
                    disabled={busy}
                    onClick={() => {
                      const next = prompt("Milestone title", m.title);
                      if (next == null || !next.trim()) return;
                      onUpdate({ milestone_id: m.id, title: next.trim() });
                    }}
                  >
                    Edit
                  </button>
                </>
              )}
              {isAdmin && onDelete && (
                <button className="btn-danger text-xs" disabled={busy} onClick={() => onDelete(m.id)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MeetingsPanel({
  meetings, canAdd, canEdit, isAdmin, busy, onAdd, onUpdate, onDelete,
}: {
  meetings: Meeting[];
  canAdd: boolean;
  canEdit?: boolean;
  isAdmin?: boolean;
  busy: boolean;
  onAdd: (b: Record<string, unknown>) => Promise<unknown>;
  onUpdate?: (b: Record<string, unknown>) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  const [agenda, setAgenda] = useState("");
  const [notes, setNotes] = useState("");
  const [nextActions, setNextActions] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [venue, setVenue] = useState("");

  return (
    <div className="space-y-4">
      {canAdd && (
        <form
          className="card p-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await onAdd({ meeting_date: time ? localInputToPktIso(`${date}T${time}`) : date, venue, agenda, notes, next_actions: nextActions, attendance: [] });
            setAgenda("");
            setNotes("");
            setNextActions("");
          }}
        >
          <h3 className="font-semibold text-navy">Log or schedule a meeting</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="label">Time (PKT, optional)</label>
              <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Venue / meeting link (optional)</label>
              <input className="input" placeholder="Room 12 or https://meet.google.com/…" value={venue} onChange={(e) => setVenue(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Agenda</label>
              <input className="input" value={agenda} onChange={(e) => setAgenda(e.target.value)} required />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <label className="label">Next actions</label>
              <textarea className="input min-h-[70px]" value={nextActions} onChange={(e) => setNextActions(e.target.value)} />
            </div>
          </div>
          <button className="btn-primary" disabled={busy} type="submit">Save meeting</button>
        </form>
      )}
      <div className="space-y-3">
        {meetings.map((m) => {
          let attendance: string[] = [];
          try { attendance = JSON.parse(m.attendance || "[]"); } catch { /* ignore */ }
          return (
            <div key={m.id} className="card p-4">
              <div className="font-medium text-navy">
                {m.meeting_date.includes("T") ? formatDate(m.meeting_date) : formatDateShort(m.meeting_date)} — {m.agenda}
              </div>
              {(m as Meeting & { venue?: string | null }).venue && (
                <div className="text-xs text-slate-500">Venue: {(m as Meeting & { venue?: string | null }).venue}</div>
              )}
              <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{m.notes}</p>
              {m.next_actions && <p className="text-sm text-teal-800 mt-2"><span className="font-medium">Next:</span> {m.next_actions}</p>}
              {!!attendance.length && <p className="text-xs text-slate-500 mt-2">Attendance: {attendance.join(", ")}</p>}
              <div className="flex flex-wrap gap-2 mt-2">
                {canEdit && onUpdate && (
                  <button
                    className="btn-secondary text-xs"
                    disabled={busy}
                    onClick={() => {
                      const agenda2 = prompt("Agenda", m.agenda);
                      if (agenda2 == null) return;
                      const notes2 = prompt("Notes", m.notes || "");
                      if (notes2 == null) return;
                      onUpdate({ meeting_id: m.id, agenda: agenda2, notes: notes2 });
                    }}
                  >
                    Edit
                  </button>
                )}
                {isAdmin && onDelete && (
                  <button className="btn-danger text-xs" disabled={busy} onClick={() => onDelete(m.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!meetings.length && <p className="text-sm text-slate-500">No meetings logged.</p>}
      </div>
    </div>
  );
}

function DefencesPanel({
  defences, th1Signed, isSupervisor, isAdmin, busy, onResult, onDelete,
}: {
  defences: Defence[];
  th1Signed: boolean;
  isSupervisor: boolean;
  isAdmin?: boolean;
  busy: boolean;
  onResult: (b: Record<string, unknown>) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  return (
    <div className="space-y-3">
      {!th1Signed && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Cannot schedule / record defences until the GEC/panel formation form is signed. Create the proposal form from Overview.</p>}
      {defences.map((d) => (
        <div key={d.id} className="card p-4 space-y-2">
          <div className="flex flex-wrap justify-between gap-2">
            <div className="font-semibold text-navy capitalize">{d.defence_type.replace(/_/g, " ")} defence</div>
            <StatusBadge status={d.result} />
          </div>
          <div className="text-sm text-slate-600">
            Scheduled: {formatDate(d.scheduled_at)} · Venue: {d.venue || "—"}
          </div>
          {d.comments && <p className="text-sm text-slate-500">{d.comments}</p>}
          {isSupervisor && d.result === "pending" && th1Signed && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary text-xs" disabled={busy} onClick={() => onResult({ defence_id: d.id, result: "pass", comments: "Passed" })}>Record pass</button>
              <button className="btn-secondary text-xs" disabled={busy} onClick={() => onResult({ defence_id: d.id, result: "conditional_pass" })}>Conditional</button>
              <button className="btn-danger text-xs" disabled={busy} onClick={() => onResult({ defence_id: d.id, result: "fail" })}>Fail</button>
            </div>
          )}
          {isAdmin && onDelete && (
            <button className="btn-danger text-xs" disabled={busy} onClick={() => onDelete(d.id)}>Delete</button>
          )}
        </div>
      ))}
      {!defences.length && <div className="card p-5 text-sm text-slate-500">No defences scheduled. Use proposal / defence forms on Overview.</div>}
    </div>
  );
}

function DocumentsPanel({
  documents, gec, canUpload, canEdit, isAdmin, busy, user, pendingRolesFor, onUpload, onUpdate, onDelete, onSign,
}: {
  documents: DocWithSig[];
  gec: GecRow[];
  canUpload: boolean;
  canEdit?: boolean;
  isAdmin?: boolean;
  busy: boolean;
  user: User;
  pendingRolesFor: (s: DocWithSig["signatures"]) => string[];
  onUpload: (b: Record<string, unknown>) => Promise<unknown>;
  onUpdate?: (b: Record<string, unknown>) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
  onSign: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("synopsis");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [shared, setShared] = useState(false);
  const [requires, setRequires] = useState(false);
  const [formError, setFormError] = useState("");
  const googleOk = /^https:\/\/(docs|drive)\.google\.com\//i.test(url.trim());
  const emails = gec.map((g) => g.user_email).filter(Boolean).join(", ");

  return (
    <div className="space-y-4">
      {canUpload && (
        <form
          className="card p-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setFormError("");
            if (!googleOk) {
              setFormError("Paste an https://docs.google.com or https://drive.google.com link.");
              return;
            }
            if (!shared) {
              setFormError("Please confirm you shared the document with the GEC members (Editor).");
              return;
            }
            const res = await onUpload({
              title,
              doc_type: docType,
              external_url: url.trim(),
              note,
              shared_with_gec: shared,
              requires_signatures: requires,
            });
            if (res) {
              setTitle("");
              setUrl("");
              setNote("");
              setShared(false);
            }
          }}
        >
          <h3 className="font-semibold text-navy">Submit document link</h3>
          <div className="rounded-lg bg-teal-50 border border-teal-100 p-3 text-sm text-slate-700 space-y-2">
            <p>
              To save storage, documents are not uploaded here. Keep your synopsis / thesis in{" "}
              <strong>Google Docs</strong>, then:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>In Google Docs click <strong>Share</strong> and add every GEC member below as <strong>Editor</strong>.</li>
              <li>Copy the document link and paste it below.</li>
            </ol>
            <div className="text-xs">
              <div className="font-medium text-navy mb-1">GEC members to share with:</div>
              {gec.length ? (
                <ul className="space-y-0.5">
                  {gec.map((g) => (
                    <li key={g.id}>
                      {g.user_name} <span className="text-slate-500">({roleLabelForGec(g.gec_role)})</span> —{" "}
                      <span className="font-mono select-all">{g.user_email}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-amber-700">No GEC members yet — share with your supervisor for now.</p>
              )}
              {emails && (
                <div className="mt-2">
                  <span className="text-slate-500">All emails (copy):</span>{" "}
                  <span className="font-mono select-all break-all">{emails}</span>
                </div>
              )}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Document type</label>
              <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {[
                  ["synopsis", "Synopsis"],
                  ["proposal", "Proposal"],
                  ["thesis_draft", "Thesis draft"],
                  ["final_thesis", "Final thesis"],
                  ["slides", "Slides"],
                  ["form", "Form"],
                  ["meeting_notes", "Meeting notes"],
                  ["other", "Other"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Title</label>
              <input className="input" placeholder="e.g. MS Synopsis v1" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="label">Google Docs / Drive link *</label>
            <input
              className="input"
              type="url"
              placeholder="https://docs.google.com/document/d/…/edit"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            {url && !googleOk && (
              <p className="text-xs text-rose-600 mt-1">Must start with https://docs.google.com/ or https://drive.google.com/</p>
            )}
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <textarea className="input min-h-[60px]" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={shared} onChange={(e) => setShared(e.target.checked)} required />
            <span>I have shared this document with the GEC members with edit access *</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={requires} onChange={(e) => setRequires(e.target.checked)} />
            Require GEC e-signatures on this submission
          </label>
          {formError && <p className="text-sm text-rose-700 bg-rose-50 rounded px-2 py-1">{formError}</p>}
          <button className="btn-primary" disabled={busy} type="submit">Submit link</button>
        </form>
      )}
      <div className="space-y-3">
        {documents.map((d) => {
          const already = d.signatures.some((s) => s.user_id === user.id);
          return (
            <div key={d.id} className="card p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="font-medium text-navy">{d.title} <span className="text-xs text-slate-400">v{d.version}</span></div>
                  <div className="text-xs text-slate-500">
                    {d.doc_type.replace(/_/g, " ")} · by {d.uploader_name} · {formatDate(d.created_at)}
                    {d.file_name && !d.external_url ? ` · ${d.file_name}` : ""}
                  </div>
                  {d.external_url && (
                    <a
                      href={d.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-1 text-sm font-medium text-teal-700 hover:underline"
                    >
                      Open in Google Docs ↗
                    </a>
                  )}
                </div>
                {d.requires_signatures ? (
                  d.signatures.length ? <span className="badge-success">Partial/signed</span> : <span className="badge-warning">Signatures required</span>
                ) : (
                  <span className="badge-muted">No sig required</span>
                )}
              </div>
              {d.content_text && <p className="text-sm text-slate-600 mt-2 line-clamp-3">{d.content_text}</p>}
              <div className="flex flex-wrap gap-2 mt-2">
                {canEdit && onUpdate && (
                  <button
                    className="btn-secondary text-xs"
                    disabled={busy}
                    onClick={() => {
                      const title = prompt("Document title", d.title);
                      if (title == null || !title.trim()) return;
                      const link = prompt("Google Docs / Drive link", d.external_url || "");
                      if (link == null) return;
                      const body: Record<string, unknown> = { document_id: d.id, title: title.trim() };
                      if (link.trim()) body.external_url = link.trim();
                      onUpdate(body);
                    }}
                  >
                    Edit
                  </button>
                )}
                {isAdmin && onDelete && (
                  <button className="btn-danger text-xs" disabled={busy} onClick={() => onDelete(d.id)}>
                    Delete
                  </button>
                )}
              </div>
              {!!d.requires_signatures && (
                <div className="mt-3">
                  <SignatureList signatures={d.signatures} pendingRoles={pendingRolesFor(d.signatures)} />
                  {!already && (
                    <button className="btn-navy text-xs mt-2" onClick={() => onSign(d.id)}>E-sign document</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GecPanel({
  projectId, gec, forms, documents, facultyPool, isSupervisor, isAdmin, user, busy, onInvite, onAccept, onUpdateRole, onDelete, onSignForm, onSignDoc, programType,
}: {
  projectId: string;
  gec: GecRow[];
  forms: FormWithSig[];
  documents: DocWithSig[];
  facultyPool: User[];
  isSupervisor: boolean;
  isAdmin?: boolean;
  user: User;
  busy: boolean;
  onInvite: (b: Record<string, unknown>) => Promise<unknown>;
  onAccept: () => Promise<unknown>;
  onUpdateRole?: (b: Record<string, unknown>) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
  onSignForm: (id: string) => void;
  onSignDoc: (id: string) => void;
  programType?: string;
}) {
  const postgraduate = isPostgraduateProgram(programType);
  const roleOptions = useMemo(() => assignableGecRoles(programType), [programType]);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState(postgraduate ? "member" : "internal_examiner");
  const myMembership = useMemo(() => gec.find((g) => g.user_id === user.id), [gec, user.id]);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="font-semibold text-navy mb-3">GEC members</h3>
        <div className="space-y-2">
          {gec.map((g) => (
            <div key={g.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{g.user_name}</div>
                <div className="text-xs text-slate-500">{roleLabelForGec(g.gec_role)} · {g.user_title}</div>
              </div>
              <div className="flex items-center gap-2">
                {g.accepted_at ? <span className="badge-success">Accepted</span> : <span className="badge-warning">Invited</span>}
                {isSupervisor && onUpdateRole && g.gec_role !== "supervisor" && (
                  postgraduate ? (
                    <select
                      key={`${g.id}-${g.gec_role}`}
                      className="input text-xs py-1"
                      aria-label={`Role for ${g.user_name}`}
                      defaultValue={g.gec_role}
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.value && e.target.value !== g.gec_role) {
                          onUpdateRole({ member_id: g.id, gec_role: e.target.value });
                        }
                      }}
                    >
                      {!roleOptions.some((opt) => opt.value === g.gec_role) && (
                        <option value={g.gec_role}>{roleLabelForGec(g.gec_role)}</option>
                      )}
                      {roleOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      className="btn-secondary text-xs"
                      disabled={busy}
                      onClick={() => {
                        const next = prompt("GEC role (co_supervisor / internal_examiner / external_examiner)", g.gec_role);
                        if (!next) return;
                        onUpdateRole({ member_id: g.id, gec_role: next });
                      }}
                    >
                      Edit role
                    </button>
                  )
                )}
                {isAdmin && onDelete && g.gec_role !== "supervisor" && (
                  <button className="btn-danger text-xs" disabled={busy} onClick={() => onDelete(g.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {myMembership && !myMembership.accepted_at && (
          <button className="btn-primary mt-3" disabled={busy} onClick={onAccept}>Accept GEC invitation</button>
        )}
        {isSupervisor && (
          <div className="mt-4 flex flex-wrap gap-2 items-end">
            <div>
              <label className="label">Invite member</label>
              <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Select…</option>
                {facultyPool.filter((u) => !gec.some((g) => g.user_id === u.id)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                {roleOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <button className="btn-primary" disabled={busy || !userId} onClick={() => onInvite({ user_id: userId, gec_role: role })}>Invite</button>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-navy">Signature inbox</h3>
        {forms.filter((f) => f.status === "pending_signatures" && !f.signatures.some((s) => s.user_id === user.id)).map((f) => (
          <div key={f.id} className="flex justify-between items-center gap-2 border rounded-lg px-3 py-2">
            <div className="text-sm">Form {(f as FormWithSig).display_name || f.form_type} awaiting your signature</div>
            <button className="btn-navy text-xs" onClick={() => onSignForm(f.id)}>Sign</button>
          </div>
        ))}
        {documents.filter((d) => d.requires_signatures && !d.signatures.some((s) => s.user_id === user.id)).map((d) => (
          <div key={d.id} className="flex justify-between items-center gap-2 border rounded-lg px-3 py-2">
            <div className="text-sm">Doc “{d.title}” awaiting signature</div>
            <button className="btn-navy text-xs" onClick={() => onSignDoc(d.id)}>Sign</button>
          </div>
        ))}
        {!forms.some((f) => f.status === "pending_signatures") && !documents.some((d) => d.requires_signatures) && (
          <p className="text-sm text-slate-500">Nothing pending for signatures.</p>
        )}
        <p className="text-[11px] text-slate-400">Project {projectId}</p>
      </div>
    </div>
  );
}
