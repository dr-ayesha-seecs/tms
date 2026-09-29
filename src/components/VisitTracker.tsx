"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

let last: { path: string; at: number } | null = null;

/**
 * Sends a tiny page-view beacon on each signed-in page view. The server only writes to the DB
 * on the first view of the day or at most every ~5 minutes per user (see src/lib/visits.ts).
 */
export function VisitTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const now = Date.now();
    // de-dupe React strict-mode double effects / rapid re-renders of the same page
    if (last && last.path === pathname && now - last.at < 2000) return;
    last = { path: pathname, at: now };
    fetch("/api/track", { method: "POST", keepalive: true, cache: "no-store" }).catch(() => undefined);
  }, [pathname]);
  return null;
}
