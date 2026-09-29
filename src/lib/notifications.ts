import { getDb, withDbMutation, now as nowIso } from "./db";
import type { User } from "./types";
import { parsePkt, daysUntilPkt, pktDateKey, fmtPkt } from "./pkt";

export type Urgency = "red" | "amber" | "blue";

export interface AppNotification {
  key: string;
  title: string;
  body: string;
  href: string;
  urgency: Urgency;
  category: "defence" | "meeting" | "action" | "review" | "summary";
  when?: string; // ISO, for sorting/display
  read?: boolean;
}

type Row = Record<string, unknown>;
const DONE_STAGES = new Set(["complete"]);
const DONE_STATUS = new Set(["completed", "closed", "withdrawn", "rejected"]);
const URG_ORDER: Record<Urgency, number> = { red: 0, amber: 1, blue: 2 };

function projectHref(id: string, tab?: string) {
  return tab ? `/projects/${id}?tab=${encodeURIComponent(tab)}` : `/projects/${id}`;
}

function defenceLabel(t: string) {
  return (
    { proposal: "Proposal defence", in_house: "In-house defence", final: "Final defence" } as Record<string, string>
  )[t] || `${t.replace(/_/g, " ")} defence`;
}

function countdownText(days: number) {
  if (days <= 0) return "TODAY";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Student countdown bucket: 14/7/3/1/0 */
function studentBucket(days: number): string | null {
  if (days < 0) return null;
  if (days === 0) return "d0";
  if (days <= 1) return "d1";
  if (days <= 3) return "d3";
  if (days <= 7) return "d7";
  if (days <= 14) return "d14";
  return null;
}

/** Faculty attend bucket: 7/1/today/soon (<=2h) */
function facultyBucket(when: Date, allDay: boolean, now: Date): string | null {
  const diff = when.getTime() - now.getTime();
  const days = daysUntilPkt(when, now);
  if (!allDay && diff > 0 && diff <= 2 * 3600 * 1000) return "soon";
  if (days < 0) return null;
  if (!allDay && diff < -3 * 3600 * 1000) return null; // well past
  if (days === 0) return "d0";
  if (days <= 1) return "d1";
  if (days <= 7) return "d7";
  return null;
}

async function studentProjects(userId: string): Promise<Row[]> {
  const db = await getDb();
  return (await db
    .prepare(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_students ps ON ps.project_id = p.id
       WHERE p.student_id = ? OR ps.student_id = ?`
    )
    .all(userId, userId)) as Row[];
}

async function facultyProjects(userId: string): Promise<(Row & { my_role: string })[]> {
  const db = await getDb();
  return (await db
    .prepare(
      `SELECT DISTINCT p.*,
         CASE WHEN p.supervisor_id = ? THEN 'supervisor' ELSE COALESCE(g.gec_role, 'member') END AS my_role
       FROM projects p
       LEFT JOIN gec_members g ON g.project_id = p.id AND g.user_id = ?
       WHERE p.supervisor_id = ? OR g.user_id = ?`
    )
    .all(userId, userId, userId, userId)) as (Row & { my_role: string })[];
}

function isActive(p: Row) {
  return !DONE_STAGES.has(String(p.stage)) && !DONE_STATUS.has(String(p.status));
}

export async function computeNotifications(user: User, now = new Date()): Promise<AppNotification[]> {
  const db = await getDb();
  const out: AppNotification[] = [];
  const today = pktDateKey(now);

  // ---------------- Students ----------------
  if (user.role === "student") {
    const interests = (await db
      .prepare(
        `SELECT x.id, x.idea_id, i.title FROM interests x JOIN ideas i ON i.id = x.idea_id
         WHERE x.student_id = ? AND x.status = 'pending'`
      )
      .all(user.id)) as Row[];
    for (const x of interests) {
      out.push({
        key: `stu:interest:${x.id}:${today}`,
        title: "Interest awaiting supervisor response",
        body: `Your interest in “${x.title}” is still pending with the supervisor.`,
        href: `/ideas/${x.idea_id}`,
        urgency: "blue",
        category: "action",
      });
    }

    for (const p of (await studentProjects(user.id)).filter(isActive)) {
      const pid = String(p.id);
      const ptitle = String(p.title);

      const gecForm = (await db
        .prepare(`SELECT status FROM forms WHERE project_id = ? AND form_type = 'gec_formation' ORDER BY created_at DESC`)
        .get(pid)) as { status: string } | undefined;
      const gecCount = ((await db
        .prepare(`SELECT COUNT(*) as c FROM gec_members WHERE project_id = ? AND gec_role != 'supervisor'`)
        .get(pid)) as { c: number }).c;
      if (!gecForm || !["signed", "approved"].includes(gecForm.status)) {
        out.push({
          key: `stu:gec:${pid}:${today}`,
          title: "GEC not yet formed",
          body: `${ptitle}: ${gecCount ? "GEC formation form is not fully signed yet." : "No GEC members invited yet."} Please follow up with your supervisor.`,
          href: projectHref(pid, "GEC & Signatures"),
          urgency: "amber",
          category: "action",
        });
      }

      const docs = (await db
        .prepare(`SELECT doc_type FROM documents WHERE project_id = ?`)
        .all(pid)) as { doc_type: string }[];
      const hasDoc = (types: string[]) => docs.some((d) => types.includes(d.doc_type));
      if (!hasDoc(["synopsis", "proposal"])) {
        out.push({
          key: `stu:synopsis:${pid}:${today}`,
          title: "Synopsis / proposal link not submitted",
          body: `${ptitle}: submit the Google Docs link of your synopsis/proposal (shared with GEC as Editor).`,
          href: projectHref(pid, "Documents"),
          urgency: "amber",
          category: "action",
        });
      }

      // Milestones
      const ms = (await db
        .prepare(`SELECT id, title, due_date, status FROM milestones WHERE project_id = ? AND status != 'done' AND due_date IS NOT NULL`)
        .all(pid)) as Row[];
      for (const m of ms) {
        const d = parsePkt(String(m.due_date));
        if (!d) continue;
        const days = daysUntilPkt(d.date, now);
        if (days > 7) continue;
        out.push({
          key: `stu:milestone:${m.id}:${today}`,
          title: days < 0 ? "Milestone overdue" : "Milestone due soon",
          body: `${ptitle}: “${m.title}” ${days < 0 ? `was due ${-days} day(s) ago` : days === 0 ? "is due today" : `is due in ${days} day(s)`} (${fmtPkt(d.date, true)}).`,
          href: projectHref(pid, "Progress"),
          urgency: days <= 0 ? "red" : days <= 3 ? "amber" : "blue",
          category: "action",
          when: d.date.toISOString(),
        });
      }

      // Meetings: recent + upcoming
      const meetings = (await db
        .prepare(`SELECT id, meeting_date, agenda, venue FROM meetings WHERE project_id = ?`)
        .all(pid)) as Row[];
      let recent = false;
      for (const m of meetings) {
        const d = parsePkt(String(m.meeting_date));
        if (!d) continue;
        const days = daysUntilPkt(d.date, now);
        if (days <= 0 && days >= -14) recent = true;
        const diff = d.date.getTime() - now.getTime();
        const upcoming = d.allDay ? days >= 0 : diff > -3600 * 1000;
        if (upcoming && days <= 3) {
          out.push({
            key: `stu:meeting:${m.id}:${days}`,
            title: days === 0 ? "Meeting today" : "Upcoming meeting",
            body: `${ptitle}: “${m.agenda}” ${countdownText(days)} — ${fmtPkt(d.date, d.allDay)}${m.venue ? ` · ${m.venue}` : ""}.`,
            href: projectHref(pid, "Meetings"),
            urgency: days === 0 ? "red" : "amber",
            category: "meeting",
            when: d.date.toISOString(),
          });
        }
      }
      if (!recent) {
        out.push({
          key: `stu:nomeeting:${pid}:${today}`,
          title: "No meeting in the last 14 days",
          body: `${ptitle}: no supervisor meeting has been logged in 14 days. Schedule one and log it.`,
          href: projectHref(pid, "Meetings"),
          urgency: "amber",
          category: "action",
        });
      }

      // Defences
      const defs = (await db
        .prepare(`SELECT id, defence_type, scheduled_at, venue, result, comments FROM defences WHERE project_id = ?`)
        .all(pid)) as Row[];
      for (const df of defs) {
        if (df.result === "conditional_pass") {
          out.push({
            key: `stu:changes:${df.id}:${today}`,
            title: "Changes requested by GEC",
            body: `${ptitle}: ${defenceLabel(String(df.defence_type))} was a conditional pass. Address GEC comments${df.comments ? `: “${df.comments}”` : ""}.`,
            href: projectHref(pid, "Defences"),
            urgency: "amber",
            category: "action",
          });
        }
        if (df.result !== "pending") continue;
        const d = parsePkt(df.scheduled_at as string);
        if (!d) continue;
        const days = daysUntilPkt(d.date, now);
        const bucket = studentBucket(days);
        const label = defenceLabel(String(df.defence_type));
        if (bucket) {
          out.push({
            key: `stu:defence:${df.id}:${bucket}`,
            title: `${days <= 3 ? "URGENT: " : ""}${label} ${countdownText(days)}`,
            body: `${ptitle}: ${fmtPkt(d.date, d.allDay)} · Venue: ${df.venue || "TBA"}. Get ready — review your slides and document.`,
            href: projectHref(pid, "Defences"),
            urgency: days <= 0 ? "red" : days <= 3 ? "amber" : "blue",
            category: "defence",
            when: d.date.toISOString(),
          });
        }
        const required =
          df.defence_type === "proposal" ? ["synopsis", "proposal"] : ["thesis_draft", "final_thesis"];
        if (days >= 0 && days <= 30 && !hasDoc(required)) {
          out.push({
            key: `stu:defdoc:${df.id}:${today}`,
            title: "Required document link missing for defence",
            body: `${ptitle}: ${label} is ${countdownText(days)} but no ${required.join("/").replace(/_/g, " ")} link has been submitted.`,
            href: projectHref(pid, "Documents"),
            urgency: days <= 3 ? "red" : "amber",
            category: "action",
            when: d.date.toISOString(),
          });
        }
      }
    }
  }

  // ---------------- Faculty / external examiners ----------------
  if (user.role === "faculty" || user.role === "external_examiner") {
    const projects = (await facultyProjects(user.id)).filter(isActive);
    for (const p of projects) {
      const pid = String(p.id);
      const ptitle = String(p.title);
      const role = String(p.my_role).replace(/_/g, " ");

      const defs = (await db
        .prepare(`SELECT id, defence_type, scheduled_at, venue, result FROM defences WHERE project_id = ?`)
        .all(pid)) as Row[];
      for (const df of defs) {
        const d = parsePkt(df.scheduled_at as string);
        if (!d) continue;
        const label = defenceLabel(String(df.defence_type));
        if (df.result === "pending") {
          const bucket = facultyBucket(d.date, d.allDay, now);
          const days = daysUntilPkt(d.date, now);
          if (bucket) {
            out.push({
              key: `fac:defence:${df.id}:${bucket}`,
              title: bucket === "soon" ? `Starting soon: ${label}` : `Attend ${label} ${countdownText(days)}`,
              body: `${ptitle} (you: ${role}) — ${fmtPkt(d.date, d.allDay)} · Venue: ${df.venue || "TBA"}.`,
              href: projectHref(pid, "Defences"),
              urgency: bucket === "soon" || bucket === "d0" ? "red" : days <= 3 ? "amber" : "blue",
              category: "defence",
              when: d.date.toISOString(),
            });
          }
          const past = d.date.getTime() < now.getTime() - 3 * 3600 * 1000;
          if (past && p.supervisor_id === user.id) {
            out.push({
              key: `fac:defresult:${df.id}:${today}`,
              title: "Defence result not entered",
              body: `${ptitle}: ${label} was on ${fmtPkt(d.date, d.allDay)} — please record the result.`,
              href: projectHref(pid, "Defences"),
              urgency: "red",
              category: "action",
              when: d.date.toISOString(),
            });
          }
        }
      }

      const meetings = (await db
        .prepare(`SELECT id, meeting_date, agenda, venue FROM meetings WHERE project_id = ?`)
        .all(pid)) as Row[];
      for (const m of meetings) {
        const d = parsePkt(String(m.meeting_date));
        if (!d) continue;
        const bucket = facultyBucket(d.date, d.allDay, now);
        if (!bucket) continue;
        const days = daysUntilPkt(d.date, now);
        out.push({
          key: `fac:meeting:${m.id}:${bucket}`,
          title: bucket === "soon" ? `Starting soon: meeting` : `Attend meeting ${countdownText(days)}`,
          body: `${ptitle}: “${m.agenda}” — ${fmtPkt(d.date, d.allDay)}${m.venue ? ` · ${m.venue}` : ""}.`,
          href: projectHref(pid, "Meetings"),
          urgency: bucket === "soon" || bucket === "d0" ? "red" : days <= 3 ? "amber" : "blue",
          category: "meeting",
          when: d.date.toISOString(),
        });
      }

      // Recently submitted document links for review (last 14 days, by others)
      const docs = (await db
        .prepare(
          `SELECT d.id, d.title, d.doc_type, d.created_at, u.name as by_name FROM documents d
           JOIN users u ON u.id = d.uploaded_by
           WHERE d.project_id = ? AND d.uploaded_by != ?`
        )
        .all(pid, user.id)) as Row[];
      for (const doc of docs) {
        const created = new Date(String(doc.created_at));
        if (now.getTime() - created.getTime() > 14 * 86400000) continue;
        out.push({
          key: `fac:doc:${doc.id}`,
          title: "Document submitted for review",
          body: `${ptitle}: ${doc.by_name} submitted “${doc.title}” (${String(doc.doc_type).replace(/_/g, " ")}).`,
          href: projectHref(pid, "Documents"),
          urgency: "blue",
          category: "review",
          when: created.toISOString(),
        });
      }
    }

    // Interests awaiting my response
    const interests = (await db
      .prepare(
        `SELECT i.id as idea_id, i.title, COUNT(*) as c FROM interests x JOIN ideas i ON i.id = x.idea_id
         WHERE i.faculty_id = ? AND x.status = 'pending' GROUP BY i.id, i.title`
      )
      .all(user.id)) as Row[];
    for (const x of interests) {
      out.push({
        key: `fac:interests:${x.idea_id}:${today}`,
        title: "Student interests awaiting response",
        body: `${x.c} student(s) interested in “${x.title}”. Accept or reject.`,
        href: `/ideas/${x.idea_id}`,
        urgency: "amber",
        category: "action",
      });
    }

    // E-signatures pending (forms + documents where I am GEC)
    const forms = (await db
      .prepare(
        `SELECT f.id, f.project_id, f.form_type, p.title FROM forms f
         JOIN gec_members g ON g.project_id = f.project_id AND g.user_id = ?
         JOIN projects p ON p.id = f.project_id
         WHERE f.status = 'pending_signatures'
           AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.target_type='form' AND s.target_id=f.id AND s.user_id=?)`
      )
      .all(user.id, user.id)) as Row[];
    for (const f of forms) {
      out.push({
        key: `fac:sign:form:${f.id}:${today}`,
        title: "E-signature pending",
        body: `${f.title}: form “${String(f.form_type).replace(/_/g, " ")}” awaits your signature.`,
        href: projectHref(String(f.project_id), "GEC & Signatures"),
        urgency: "amber",
        category: "action",
      });
    }
    const sdocs = (await db
      .prepare(
        `SELECT d.id, d.project_id, d.title, p.title as ptitle FROM documents d
         JOIN gec_members g ON g.project_id = d.project_id AND g.user_id = ?
         JOIN projects p ON p.id = d.project_id
         WHERE d.requires_signatures = 1
           AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.target_type='document' AND s.target_id=d.id AND s.user_id=?)`
      )
      .all(user.id, user.id)) as Row[];
    for (const d of sdocs) {
      out.push({
        key: `fac:sign:doc:${d.id}:${today}`,
        title: "Document e-signature pending",
        body: `${d.ptitle}: “${d.title}” awaits your e-signature.`,
        href: projectHref(String(d.project_id), "GEC & Signatures"),
        urgency: "amber",
        category: "action",
      });
    }
  }

  // ---------------- Admin ----------------
  if (user.role === "admin") {
    const defs = (await db
      .prepare(
        `SELECT d.id, d.project_id, d.defence_type, d.scheduled_at, p.title FROM defences d
         JOIN projects p ON p.id = d.project_id WHERE d.result = 'pending' AND d.scheduled_at IS NOT NULL`
      )
      .all()) as Row[];
    const overdue = defs.filter((d) => {
      const pd = parsePkt(d.scheduled_at as string);
      return pd && pd.date.getTime() < now.getTime() - 3 * 3600 * 1000;
    });
    if (overdue.length) {
      out.push({
        key: `adm:defnoresult:${today}:${overdue.length}`,
        title: `${overdue.length} defence(s) without results`,
        body: overdue
          .slice(0, 5)
          .map((d) => `${d.title} (${defenceLabel(String(d.defence_type))})`)
          .join("; ") + (overdue.length > 5 ? "; …" : ""),
        href: overdue.length === 1 ? projectHref(String(overdue[0].project_id), "Defences") : "/tracker",
        urgency: "red",
        category: "summary",
      });
    }
    const upcoming = defs.filter((d) => {
      const pd = parsePkt(d.scheduled_at as string);
      if (!pd) return false;
      const days = daysUntilPkt(pd.date, now);
      return days >= 0 && days <= 7 && pd.date.getTime() >= now.getTime() - 3 * 3600 * 1000;
    });
    if (upcoming.length) {
      out.push({
        key: `adm:defupcoming:${today}:${upcoming.length}`,
        title: `${upcoming.length} defence(s) in the next 7 days`,
        body: upcoming
          .slice(0, 5)
          .map((d) => {
            const pd = parsePkt(d.scheduled_at as string)!;
            return `${d.title} — ${fmtPkt(pd.date, pd.allDay)}`;
          })
          .join("; "),
        href: "/tracker",
        urgency: "blue",
        category: "summary",
      });
    }
    const stale = (await db
      .prepare(
        `SELECT p.id, p.title, MAX(COALESCE(a.created_at, p.updated_at), p.updated_at) as last_at
         FROM projects p LEFT JOIN activity a ON a.project_id = p.id
         WHERE p.stage != 'complete'
         GROUP BY p.id, p.title`
      )
      .all()) as Row[];
    const staleList = stale.filter(
      (s) => now.getTime() - new Date(String(s.last_at)).getTime() > 30 * 86400000
    );
    if (staleList.length) {
      out.push({
        key: `adm:stale:${today}:${staleList.length}`,
        title: `${staleList.length} project(s) with no activity in 30 days`,
        body: staleList.slice(0, 5).map((s) => String(s.title)).join("; ") + (staleList.length > 5 ? "; …" : ""),
        href: staleList.length === 1 ? projectHref(String(staleList[0].id)) : "/projects",
        urgency: "amber",
        category: "summary",
      });
    }
    const pendingInterests = ((await db
      .prepare(`SELECT COUNT(*) as c FROM interests WHERE status = 'pending'`)
      .get()) as { c: number }).c;
    if (pendingInterests) {
      out.push({
        key: `adm:interests:${today}:${pendingInterests}`,
        title: `${pendingInterests} student interest(s) awaiting faculty response`,
        body: "Faculty have not yet accepted/rejected these interests.",
        href: "/ideas",
        urgency: "blue",
        category: "summary",
      });
    }
  }

  // Apply read / dismissed state
  const states = (await db
    .prepare(`SELECT nkey, read_at, dismissed_at FROM notification_reads WHERE user_id = ?`)
    .all(user.id)) as { nkey: string; read_at: string | null; dismissed_at: string | null }[];
  const map = new Map(states.map((s) => [s.nkey, s]));
  const visible = out
    .filter((n) => !map.get(n.key)?.dismissed_at)
    .map((n) => ({ ...n, read: !!map.get(n.key)?.read_at }));

  visible.sort((a, b) => {
    if (URG_ORDER[a.urgency] !== URG_ORDER[b.urgency]) return URG_ORDER[a.urgency] - URG_ORDER[b.urgency];
    return (a.when || "9999").localeCompare(b.when || "9999");
  });
  return visible;
}

export async function markNotifications(userId: string, keys: string[], action: "read" | "dismiss" | "unread") {
  const clean = Array.from(new Set(keys.map(String).filter((k) => k && k.length < 300))).slice(0, 200);
  if (!clean.length) return 0;
  const t = nowIso();
  await withDbMutation(async (db) => {
    await db.transaction(async () => {
      for (const k of clean) {
        if (action === "unread") {
          await db.prepare(`UPDATE notification_reads SET read_at = NULL WHERE user_id = ? AND nkey = ?`).run(userId, k);
          continue;
        }
        await db
          .prepare(`INSERT OR IGNORE INTO notification_reads (user_id, nkey, read_at, dismissed_at) VALUES (?, ?, NULL, NULL)`)
          .run(userId, k);
        if (action === "read") {
          await db.prepare(`UPDATE notification_reads SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND nkey = ?`).run(t, userId, k);
        } else {
          await db
            .prepare(`UPDATE notification_reads SET read_at = COALESCE(read_at, ?), dismissed_at = ? WHERE user_id = ? AND nkey = ?`)
            .run(t, t, userId, k);
        }
      }
    });
  });
  return clean.length;
}
