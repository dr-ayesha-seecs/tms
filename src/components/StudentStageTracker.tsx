"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProgramBadge } from "@/components/ProgramBadge";

export type TrackerRow = {
  student_id: string;
  registration_no: string | null;
  name: string;
  email: string;
  department: string | null;
  project_id: string | null;
  project_title: string | null;
  program_type: string | null;
  stage: string | null;
  status: string | null;
  progress_pct: number | null;
  supervisor_name: string | null;
  tracker_stage: string;
  tracker_stage_label: string;
  interest_count: number;
};

type GroupRow = {
  project_id: string;
  project_title: string;
  program_type: string | null;
  supervisor_name: string | null;
  stage: string | null;
  progress_pct: number | null;
  tracker_stage: string;
  tracker_stage_label: string;
  members: TrackerRow[];
};

const STAGE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "no_project", label: "No project" },
  { value: "interest", label: "Interest submitted" },
  { value: "gec_formation", label: "GEC formation" },
  { value: "proposal", label: "Proposal" },
  { value: "research", label: "Research" },
  { value: "in_house", label: "In-house" },
  { value: "final", label: "Final" },
  { value: "complete", label: "Complete" },
];

function sortByRegNo(a: TrackerRow, b: TrackerRow) {
  const ra = (a.registration_no || "").toLowerCase();
  const rb = (b.registration_no || "").toLowerCase();
  if (ra && rb) return ra.localeCompare(rb, undefined, { numeric: true });
  if (ra && !rb) return -1;
  if (!ra && rb) return 1;
  return a.name.localeCompare(b.name);
}

export function StudentStageTracker({ rows }: { rows: TrackerRow[] }) {
  const router = useRouter();
  const [stageFilter, setStageFilter] = useState("all");
  const [programFilter, setProgramFilter] = useState<"all" | "FYP" | "MS_THESIS" | "none">("all");
  const [q, setQ] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"student" | "group">("student");

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.tracker_stage] = (counts[r.tracker_stage] || 0) + 1;
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (stageFilter !== "all" && r.tracker_stage !== stageFilter) return false;
        if (programFilter === "FYP" && r.program_type !== "FYP") return false;
        if (programFilter === "MS_THESIS" && r.program_type !== "MS_THESIS") return false;
        if (programFilter === "none" && r.program_type) return false;
        if (needle) {
          const memberHay = `${r.registration_no || ""} ${r.name} ${r.email} ${r.department || ""} ${r.project_title || ""} ${r.supervisor_name || ""}`.toLowerCase();
          if (!memberHay.includes(needle)) return false;
        }
        return true;
      })
      .sort(sortByRegNo);
  }, [rows, stageFilter, programFilter, q]);

  const groupRows = useMemo(() => {
    const map = new Map<string, GroupRow>();
    for (const r of filtered) {
      if (!r.project_id) continue;
      let g = map.get(r.project_id);
      if (!g) {
        g = {
          project_id: r.project_id,
          project_title: r.project_title || "Untitled project",
          program_type: r.program_type,
          supervisor_name: r.supervisor_name,
          stage: r.stage,
          progress_pct: r.progress_pct,
          tracker_stage: r.tracker_stage,
          tracker_stage_label: r.tracker_stage_label,
          members: [],
        };
        map.set(r.project_id, g);
      }
      g.members.push(r);
    }
    Array.from(map.values()).forEach((g) => g.members.sort(sortByRegNo));
    return Array.from(map.values()).sort((a, b) => a.project_title.localeCompare(b.project_title));
  }, [filtered]);

  const unassigned = filtered.filter((r) => !r.project_id);

  function activateStudent(r: TrackerRow) {
    if (r.project_id) {
      router.push(`/projects/${r.project_id}`);
      return;
    }
    setExpandedId((id) => (id === r.student_id ? null : r.student_id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {viewMode === "student"
            ? "One row per student. Members of a group share the same project."
            : "One row per project group with members and registration numbers."}
        </p>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          <button
            type="button"
            className={`px-3 py-1.5 ${viewMode === "student" ? "bg-teal-700 text-white" : "bg-white text-slate-600"}`}
            onClick={() => setViewMode("student")}
          >
            By student
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 ${viewMode === "group" ? "bg-teal-700 text-white" : "bg-white text-slate-600"}`}
            onClick={() => setViewMode("group")}
          >
            By group
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STAGE_FILTERS.map((f) => {
          const count = f.value === "all" ? rows.length : stageCounts[f.value] || 0;
          if (f.value !== "all" && count === 0 && stageFilter !== f.value) return null;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStageFilter(f.value)}
              className={`rounded-full px-3 py-1 text-xs ${
                stageFilter === f.value ? "bg-teal-700 text-white" : "bg-white border text-slate-600"
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="Reg no, name, email, project…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Program</label>
          <select
            className="input"
            value={programFilter}
            onChange={(e) =>
              setProgramFilter(e.target.value as "all" | "FYP" | "MS_THESIS" | "none")
            }
          >
            <option value="all">All programs</option>
            <option value="FYP">Undergraduate (FYP)</option>
            <option value="MS_THESIS">Postgraduate (MS)</option>
            <option value="none">No project yet</option>
          </select>
        </div>
      </div>

      {viewMode === "student" ? (
        <div className="card overflow-hidden">
          <div className="px-4 py-2 border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Students ({filtered.length}) — one row each
          </div>
          {filtered.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No students match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white text-left text-xs uppercase text-slate-400 border-b">
                  <tr>
                    <th className="px-3 py-3 whitespace-nowrap">Reg No</th>
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Email</th>
                    <th className="px-3 py-3">Department</th>
                    <th className="px-3 py-3">Program</th>
                    <th className="px-3 py-3">Project</th>
                    <th className="px-3 py-3">Supervisor</th>
                    <th className="px-3 py-3">Stage</th>
                    <th className="px-3 py-3">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <Fragment key={r.student_id}>
                      <tr
                        className="border-t hover:bg-sky-50/60 cursor-pointer"
                        onClick={() => activateStudent(r)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            activateStudent(r);
                          }
                        }}
                      >
                        <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-navy">
                          {r.registration_no || "—"}
                        </td>
                        <td className="px-3 py-3 font-medium text-navy whitespace-nowrap">{r.name}</td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{r.email}</td>
                        <td className="px-3 py-3 text-slate-600">{r.department || "—"}</td>
                        <td className="px-3 py-3">
                          {r.program_type ? (
                            <ProgramBadge programType={r.program_type} />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 max-w-[220px]">
                          {r.project_id ? (
                            <Link
                              href={`/projects/${r.project_id}`}
                              className="text-teal-700 hover:underline font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {r.project_title}
                            </Link>
                          ) : (
                            <span className="text-slate-400">No project</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                          {r.supervisor_name || "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs whitespace-nowrap">
                            {r.tracker_stage_label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                          {r.progress_pct != null ? `${r.progress_pct}%` : "—"}
                        </td>
                      </tr>
                      {expandedId === r.student_id && !r.project_id && (
                        <tr className="bg-slate-50 border-t">
                          <td colSpan={9} className="px-4 py-3 text-sm text-slate-600">
                            Pending interests: {r.interest_count}. Faculty can accept up to 3
                            interested students as a project group from the idea page.
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-4 py-2 border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Groups ({groupRows.length}) — one row per project
          </div>
          {groupRows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              No project groups match these filters.
              {unassigned.length > 0
                ? ` ${unassigned.length} unassigned student(s) — switch to By student to see them.`
                : ""}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white text-left text-xs uppercase text-slate-400 border-b">
                  <tr>
                    <th className="px-3 py-3">Project</th>
                    <th className="px-3 py-3">Program</th>
                    <th className="px-3 py-3">Supervisor</th>
                    <th className="px-3 py-3">Members</th>
                    <th className="px-3 py-3">Count</th>
                    <th className="px-3 py-3">Stage</th>
                    <th className="px-3 py-3">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((g) => (
                    <tr
                      key={g.project_id}
                      className="border-t hover:bg-sky-50/60 cursor-pointer"
                      onClick={() => router.push(`/projects/${g.project_id}`)}
                    >
                      <td className="px-3 py-3 font-medium text-navy">
                        <Link
                          href={`/projects/${g.project_id}`}
                          className="text-teal-700 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {g.project_title}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        {g.program_type ? <ProgramBadge programType={g.program_type} /> : "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                        {g.supervisor_name || "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        <ul className="space-y-0.5">
                          {g.members.map((m) => (
                            <li key={m.student_id} className="text-xs">
                              <span className="font-medium">{m.name}</span>
                              {m.registration_no ? (
                                <span className="font-mono text-slate-500"> · {m.registration_no}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{g.members.length}/3</td>
                      <td className="px-3 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs whitespace-nowrap">
                          {g.tracker_stage_label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                        {g.progress_pct != null ? `${g.progress_pct}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {unassigned.length > 0 && (
            <p className="px-4 py-2 border-t text-xs text-slate-500 bg-amber-50/50">
              Unassigned: {unassigned.length} student(s) without a project (shown in By student view).
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-slate-500">
        {viewMode === "student"
          ? `Showing ${filtered.length} of ${rows.length} student(s).`
          : `Showing ${groupRows.length} group(s); ${unassigned.length} unassigned in current filters.`}
      </p>
    </div>
  );
}
