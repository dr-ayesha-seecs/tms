"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Bell, CheckCheck, X, FileText, BarChart3 } from "lucide-react";
import type { AppNotification } from "@/lib/notifications";

const STYLES = {
  red: "border-l-rose-500 bg-rose-50",
  amber: "border-l-amber-500 bg-amber-50",
  blue: "border-l-sky-500 bg-sky-50",
} as const;
const DOT = { red: "bg-rose-500", amber: "bg-amber-500", blue: "bg-sky-500" } as const;
const LABEL = { red: "Overdue / today", amber: "Within 3 days", blue: "Info" } as const;

function Icon({ n }: { n: AppNotification }) {
  const cls = "h-4 w-4 shrink-0 mt-0.5";
  if (n.category === "defence" || n.category === "meeting") return <CalendarClock className={cls} />;
  if (n.category === "review") return <FileText className={cls} />;
  if (n.category === "summary") return <BarChart3 className={cls} />;
  if (n.urgency === "red") return <AlertTriangle className={cls} />;
  return <Bell className={cls} />;
}

export function NotificationsList({
  initial,
  limit,
  compact = false,
}: {
  initial: AppNotification[];
  limit?: number;
  compact?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const shown = limit ? items.slice(0, limit) : items;
  const unread = items.filter((n) => !n.read).length;

  async function act(action: "read" | "dismiss" | "read_all", keys: string[] = []) {
    setBusy(true);
    if (action === "dismiss") setItems((p) => p.filter((n) => !keys.includes(n.key)));
    else if (action === "read") setItems((p) => p.map((n) => (keys.includes(n.key) ? { ...n, read: true } : n)));
    else setItems((p) => p.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, keys }),
    }).catch(() => null);
    setBusy(false);
    window.dispatchEvent(new Event("tms-notifications-changed"));
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
          {(["red", "amber", "blue"] as const).map((u) => (
            <span key={u} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${DOT[u]}`} /> {LABEL[u]}
            </span>
          ))}
          <span>· Times in PKT</span>
        </div>
        {unread > 0 && (
          <button className="text-xs text-teal-700 hover:underline flex items-center gap-1" disabled={busy} onClick={() => act("read_all")}>
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        )}
      </div>
      {!shown.length && (
        <p className="text-sm text-slate-500 py-3">You&apos;re all caught up — no pending reminders.</p>
      )}
      <ul className="space-y-2">
        {shown.map((n) => (
          <li
            key={n.key}
            data-urgency={n.urgency}
            className={`rounded-lg border border-slate-100 border-l-4 ${STYLES[n.urgency]} ${n.read ? "opacity-70" : ""} px-3 py-2`}
          >
            <div className="flex gap-2">
              <span className={n.urgency === "red" ? "text-rose-600" : n.urgency === "amber" ? "text-amber-600" : "text-sky-600"}>
                <Icon n={n} />
              </span>
              <div className="flex-1 min-w-0">
                <Link
                  href={n.href}
                  onClick={() => !n.read && act("read", [n.key])}
                  className="block hover:underline"
                >
                  <div className={`text-sm ${n.read ? "font-normal" : "font-semibold"} text-navy`}>
                    {!n.read && <span className={`inline-block h-2 w-2 rounded-full mr-1.5 align-middle ${DOT[n.urgency]}`} />}
                    {n.title}
                  </div>
                  <div className={`text-xs text-slate-600 ${compact ? "line-clamp-2" : ""}`}>{n.body}</div>
                </Link>
              </div>
              <div className="flex items-start gap-1 shrink-0">
                {!n.read && (
                  <button title="Mark read" className="p-1 text-slate-400 hover:text-teal-700" disabled={busy} onClick={() => act("read", [n.key])}>
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                )}
                <button title="Dismiss" className="p-1 text-slate-400 hover:text-rose-600" disabled={busy} onClick={() => act("dismiss", [n.key])}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {limit && items.length > limit && (
        <Link href="/notifications" className="text-xs text-teal-700 hover:underline">
          View all {items.length} notifications →
        </Link>
      )}
    </div>
  );
}
