"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@/lib/types";

import Image from "next/image";
import Link from "next/link";
import {
  LayoutDashboard,
  Lightbulb,
  FolderKanban,
  FileText,
  LogOut,
  Settings,
  Activity,
  KeyRound,
  BarChart3,
} from "lucide-react";
import { VisitTracker } from "@/components/VisitTracker";
import { SiteFooter } from "@/components/SiteFooter";
import { NotificationBell } from "@/components/NotificationBell";
import { Bell } from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tracker", label: "Tracker", icon: Activity, staffOnly: true },
  { href: "/forms", label: "Forms", icon: FileText },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/account/password", label: "Password", icon: KeyRound },
  { href: "/admin", label: "Admin", icon: Settings, adminOnly: true },
  { href: "/admin/activity", label: "Activity monitor", icon: BarChart3, adminOnly: true },
];

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (Number(user.must_change_password) === 1 && !pathname.startsWith("/account/password")) {
      router.replace("/account/password?forced=1");
    }
  }, [user.must_change_password, pathname, router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex">
      <VisitTracker />
      <aside className="hidden md:flex w-64 flex-col bg-navy text-white">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
          <Image
            src="/mnsuam-logo.png"
            alt="MNSUAM"
            width={44}
            height={44}
            className="rounded-full bg-white p-0.5 shrink-0"
            priority
          />
          <div className="min-w-0">
            <div className="font-bold tracking-wide text-sm leading-tight">Thesis Management System</div>
            <div className="text-[10px] text-sky-200 leading-snug mt-0.5">
              MNS University of Agriculture, Multan
            </div>
          </div>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav
            .filter((item) => {
              if ("adminOnly" in item && item.adminOnly) return user.role === "admin";
              if ("staffOnly" in item && item.staffOnly)
                return user.role === "admin" || user.role === "faculty";
              return true;
            })
            .map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin" || (pathname.startsWith("/admin/") && !pathname.startsWith("/admin/activity"))
                  : pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                    active ? "bg-mns-blue text-white" : "text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="text-sm font-medium">{user.name}</div>
          <div className="text-xs text-slate-300 capitalize">{user.role.replace("_", " ")}</div>
          <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
          <button onClick={logout} className="mt-3 flex items-center gap-2 text-xs text-rose-200 hover:text-white">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between bg-navy text-white px-4 py-3 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Image
              src="/mnsuam-logo.png"
              alt="MNSUAM"
              width={32}
              height={32}
              className="rounded-full bg-white p-0.5 shrink-0"
            />
            <div className="min-w-0">
              <div className="font-bold text-sm truncate">Thesis Management System</div>
              <div className="text-[10px] text-sky-200 truncate">MNSUAM</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NotificationBell />
            <button onClick={logout} className="text-xs underline">
              Sign out
            </button>
          </div>
        </header>
        <div className="md:hidden flex gap-1 overflow-x-auto bg-white border-b px-2 py-2">
          {nav
            .filter((item) => {
              if ("adminOnly" in item && item.adminOnly) return user.role === "admin";
              if ("staffOnly" in item && item.staffOnly)
                return user.role === "admin" || user.role === "faculty";
              return true;
            })
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
                  (item.href === "/admin"
                    ? pathname.startsWith("/admin") && !pathname.startsWith("/admin/activity")
                    : pathname.startsWith(item.href))
                    ? "bg-mns-blue text-white"
                    : "bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            ))}
        </div>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
