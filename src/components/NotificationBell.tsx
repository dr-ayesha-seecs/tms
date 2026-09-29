"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";

export function NotificationBell({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/notifications?count=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setCount(Number(d.unread) || 0))
        .catch(() => null);
    load();
    const onChange = () => load();
    window.addEventListener("tms-notifications-changed", onChange);
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener("tms-notifications-changed", onChange);
      clearInterval(t);
    };
  }, [pathname]);

  const color = variant === "dark" ? "text-white hover:bg-white/10" : "text-navy hover:bg-slate-100";
  return (
    <Link
      href="/notifications"
      aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
      data-testid="notification-bell"
      className={`relative inline-flex items-center justify-center rounded-full p-2 ${color}`}
    >
      <Bell className="h-5 w-5" />
      {!!count && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-[18px] text-white text-center">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
