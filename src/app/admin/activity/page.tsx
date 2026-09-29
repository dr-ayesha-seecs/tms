import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDb, pktDateKeyNow, MONITOR_RETENTION_DAYS } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
import {
  actionLabel,
  actionTypes,
  daySummary,
  failedLoginsOn,
  fmtPktTime,
  isDateKey,
  MONITOR_ROLES,
  queryActivity,
  ROLE_LABELS,
  trend,
  visitedOn,
} from "@/lib/activity-monitor";
import { VISIT_FLUSH_MS } from "@/lib/visits";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;

type SP = Record<string, string | string[] | undefined>;

function one(sp: SP, k: string): string {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v || "").trim();
}

function qs(base: Record<string, string>, patch: Record<string, string | number | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) {
    if (v !== null && v !== undefined && String(v) !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function roleBadge(role: string | null) {
  const r = role || "unknown";
  const cls =
    r === "student"
      ? "bg-sky-100 text-sky-800"
      : r === "faculty"
        ? "bg-teal-100 text-teal-800"
        : r === "external_examiner"
          ? "bg-amber-100 text-amber-800"
          : r === "admin"
            ? "bg-violet-100 text-violet-800"
            : "bg-slate-100 text-slate-600";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{ROLE_LABELS[r] || r}</span>;
}

export default async function ActivityMonitorPage({ searchParams }: { searchParams: SP }) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.role !== "admin") redirect("/dashboard");

  const today = pktDateKeyNow();
  let from = one(searchParams, "from");
  let to = one(searchParams, "to");
  if (!isDateKey(from)) from = today;
  if (!isDateKey(to)) to = from > today ? from : today;
  if (from > to) [from, to] = [to, from];
  const roleRaw = one(searchParams, "role");
  const role = (MONITOR_ROLES as readonly string[]).includes(roleRaw) ? roleRaw : "";
  const vroleRaw = one(searchParams, "vrole");
  const vrole = (MONITOR_ROLES as readonly string[]).includes(vroleRaw) ? vroleRaw : "";
  const q = one(searchParams, "q").slice(0, 100);
  const action = one(searchParams, "action").slice(0, 60);
  const page = Math.max(1, Math.floor(Number(one(searchParams, "page")) || 1));

  const db = await getDb();
  const summary = await daySummary(db, today);
  const days = await trend(db, today, 7);
  const visited = await visitedOn(db, today, vrole || null);
  const filters = { from, to, role: role || null, q: q || null, action: action || null };
  const { rows, total } = await queryActivity(db, filters, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const actions = await actionTypes(db);
  const failed = await failedLoginsOn(db, today);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const base: Record<string, string> = { from, to, role, q, action, vrole };
  const exportHref = `/api/admin/activity/export${qs({ from, to, role, q, action }, {})}`;
  const maxPv = Math.max(1, ...days.map((d) => d.page_views));
  const maxVisitors = Math.max(1, ...days.map((d) => d.students + d.faculty + d.external_examiners));
  const maxActs = Math.max(1, ...days.map((d) => d.actions));

  const cards = [
    { label: "Students visited today", value: summary.students, tone: "text-sky-700" },
    { label: "Faculty visited today", value: summary.faculty, tone: "text-teal-700" },
    { label: "External examiners today", value: summary.external_examiners, tone: "text-amber-700" },
    { label: "Page views today", value: summary.page_views, tone: "text-navy" },
    { label: "Actions today", value: summary.actions, tone: "text-navy", sub: `${summary.logins} sign-in${summary.logins === 1 ? "" : "s"}` },
    { label: "Failed sign-ins today", value: summary.failed_logins, tone: summary.failed_logins ? "text-rose-700" : "text-navy" },
  ];

  return (
    <AppShell user={user}>
      <div className="space-y-6" data-testid="activity-monitor">
        <div>
          <Link href="/admin" className="text-sm text-teal-700 hover:underline">
            ← Admin
          </Link>
          <h1 className="text-2xl font-bold text-navy mt-1">Activity monitor</h1>
          <p className="text-sm text-slate-500">
            Who visited today and what they did. Today is <strong>{today}</strong> (PKT). Visits refresh at most
            every {Math.round(VISIT_FLUSH_MS / 60000)} minutes per user; history is kept for {MONITOR_RETENTION_DAYS} days.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="card p-4">
              <div className="text-[11px] uppercase text-slate-400 leading-tight">{c.label}</div>
              <div className={`text-3xl font-bold mt-1 ${c.tone}`}>{c.value}</div>
              {c.sub && <div className="text-xs text-slate-500 mt-0.5">{c.sub}</div>}
            </div>
          ))}
        </div>
        {summary.admins > 0 && (
          <p className="text-xs text-slate-500 -mt-3">Admins visited today: {summary.admins}</p>
        )}

        <section className="card p-5">
          <h2 className="font-semibold text-navy mb-3">Last 7 days (PKT)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400 border-b">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Students</th>
                  <th className="py-2 pr-3">Faculty</th>
                  <th className="py-2 pr-3">Ext. examiners</th>
                  <th className="py-2 pr-3 w-1/5">Visitors</th>
                  <th className="py-2 pr-3 w-1/5">Page views</th>
                  <th className="py-2 pr-3 w-1/5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const visitors = d.students + d.faculty + d.external_examiners;
                  return (
                    <tr key={d.date} className={`border-b border-slate-50 ${d.date === today ? "bg-teal-50/50" : ""}`}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {new Date(`${d.date}T12:00:00+05:00`).toLocaleDateString("en-GB", {
                          timeZone: "Asia/Karachi",
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                        })}
                      </td>
                      <td className="py-1.5 pr-3">{d.students}</td>
                      <td className="py-1.5 pr-3">{d.faculty}</td>
                      <td className="py-1.5 pr-3">{d.external_examiners}</td>
                      {[
                        { v: visitors, max: maxVisitors, c: "bg-sky-500" },
                        { v: d.page_views, max: maxPv, c: "bg-mns-blue" },
                        { v: d.actions, max: maxActs, c: "bg-teal-500" },
                      ].map((b, i) => (
                        <td key={i} className="py-1.5 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2.5 flex-1 rounded bg-slate-100 overflow-hidden">
                              <div className={`h-full ${b.c}`} style={{ width: `${Math.round((b.v / b.max) * 100)}%` }} />
                            </div>
                            <span className="w-8 text-right tabular-nums text-xs text-slate-600">{b.v}</span>
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5" data-testid="visited-today">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold text-navy">
              Visited today <span className="text-slate-400 font-normal">({visited.length})</span>
            </h2>
            <div className="flex flex-wrap gap-1 text-xs">
              {["", ...MONITOR_ROLES].map((r) => (
                <Link
                  key={r || "all"}
                  href={`/admin/activity${qs(base, { vrole: r || null, page: null })}`}
                  className={`rounded-full px-3 py-1 ${vrole === r ? "bg-mns-blue text-white" : "bg-slate-100 hover:bg-slate-200"}`}
                >
                  {r ? ROLE_LABELS[r] : "All roles"}
                </Link>
              ))}
            </div>
          </div>
          {visited.length === 0 ? (
            <p className="text-sm text-slate-500">No visits recorded today{vrole ? ` for ${ROLE_LABELS[vrole]}` : ""}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400 border-b">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Reg. no</th>
                    <th className="py-2 pr-3">Department</th>
                    <th className="py-2 pr-3">First seen</th>
                    <th className="py-2 pr-3">Last seen</th>
                    <th className="py-2 pr-3 text-right">Page views</th>
                    <th className="py-2 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visited.map((v) => (
                    <tr key={v.user_id} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3">
                        <div className="font-medium text-slate-800">{v.name || "(deleted user)"}</div>
                        {v.email && <div className="text-[11px] text-slate-400">{v.email}</div>}
                      </td>
                      <td className="py-1.5 pr-3">{roleBadge(v.role)}</td>
                      <td className="py-1.5 pr-3">{v.role === "student" ? v.registration_no || "—" : "—"}</td>
                      <td className="py-1.5 pr-3">{v.department || "—"}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtPktTime(v.first_seen)}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtPktTime(v.last_seen)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{v.page_views}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {v.actions > 0 ? (
                          <Link
                            className="text-teal-700 hover:underline"
                            href={`/admin/activity${qs({}, { from: today, to: today, q: v.email || v.name || "", vrole: vrole || null })}#log`}
                          >
                            {v.actions}
                          </Link>
                        ) : (
                          0
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-2">
            Page views are written in batches (first view of the day, then at most every{" "}
            {Math.round(VISIT_FLUSH_MS / 60000)} min), so the last few minutes may not be counted yet.
          </p>
        </section>

        <section className="card p-5" id="log" data-testid="activity-log">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold text-navy">
              Activity log <span className="text-slate-400 font-normal">({total})</span>
            </h2>
            <a href={exportHref} className="btn-secondary text-xs" data-testid="export-csv">
              Export CSV
            </a>
          </div>
          <form method="get" action="/admin/activity#log" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 items-end mb-4 text-sm">
            <label className="block">
              <span className="text-xs text-slate-500">From (PKT)</span>
              <input type="date" name="from" defaultValue={from} className="input w-full" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">To (PKT)</span>
              <input type="date" name="to" defaultValue={to} className="input w-full" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Role</span>
              <select name="role" defaultValue={role} className="input w-full">
                <option value="">All roles</option>
                {MONITOR_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">User (name, email, reg. no)</span>
              <input type="search" name="q" defaultValue={q} placeholder="Search user" className="input w-full" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Action</span>
              <select name="action" defaultValue={action} className="input w-full">
                <option value="">All actions</option>
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              {vrole && <input type="hidden" name="vrole" value={vrole} />}
              <button type="submit" className="btn-primary">
                Filter
              </button>
              <Link href="/admin/activity#log" className="btn-secondary">
                Reset
              </Link>
            </div>
          </form>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No activity for these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400 border-b">
                    <th className="py-2 pr-3">Time (PKT)</th>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Details</th>
                    <th className="py-2 pr-3">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtPktTime(r.created_at, true)}</td>
                      <td className="py-1.5 pr-3">
                        <div className="text-slate-800">{r.actor_name || "System"}</div>
                        {r.actor_email && <div className="text-[11px] text-slate-400">{r.actor_email}</div>}
                      </td>
                      <td className="py-1.5 pr-3">{r.actor_role ? roleBadge(r.actor_role) : "—"}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap font-medium text-slate-700">{actionLabel(r.action)}</td>
                      <td className="py-1.5 pr-3 text-slate-600 break-words max-w-md">{r.detail || "—"}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {r.target_url && r.target_url.startsWith("/") ? (
                          <Link href={r.target_url} className="text-teal-700 hover:underline">
                            Open
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="text-slate-500">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link className="btn-secondary" href={`/admin/activity${qs(base, { page: page - 1 })}#log`}>
                    ← Newer
                  </Link>
                )}
                {page < pages && (
                  <Link className="btn-secondary" href={`/admin/activity${qs(base, { page: page + 1 })}#log`}>
                    Older →
                  </Link>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="card p-5" data-testid="failed-logins">
          <h2 className="font-semibold text-navy mb-3">
            Failed sign-in attempts today <span className="text-slate-400 font-normal">({failed.length})</span>
          </h2>
          {failed.length === 0 ? (
            <p className="text-sm text-slate-500">None today.</p>
          ) : (
            <table className="w-full text-sm max-w-xl">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400 border-b">
                  <th className="py-2 pr-3">Time (PKT)</th>
                  <th className="py-2 pr-3">Email entered</th>
                </tr>
              </thead>
              <tbody>
                {failed.map((f) => (
                  <tr key={f.id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtPktTime(f.created_at)}</td>
                    <td className="py-1.5 pr-3">{f.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-slate-400 mt-2">Only the email and time are stored — never passwords.</p>
        </section>
      </div>
    </AppShell>
  );
}
