import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDb, getFormTemplates } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
import { ReseedButton } from "@/components/ReseedButton";
import { ClearIdeasProjectsButton } from "@/components/ClearIdeasProjectsButton";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminHomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.role !== "admin") redirect("/dashboard");

  const db = await getDb();
  const msCount = (await getFormTemplates(db, "MS_THESIS")).length;
  const fypCount = (await getFormTemplates(db, "FYP")).length;
  const users = (await db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  const ideas = (await db.prepare("SELECT COUNT(*) as c FROM ideas").get() as { c: number }).c;
  const projects = (await db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c;

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Admin panel</h1>
          <p className="text-sm text-slate-500">
            Manage users, form display names, and system data.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-4">
            <div className="text-xs uppercase text-slate-400">Users</div>
            <div className="text-3xl font-bold text-navy mt-1">{users}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs uppercase text-slate-400">Ideas</div>
            <div className="text-3xl font-bold text-navy mt-1">{ideas}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs uppercase text-slate-400">Projects</div>
            <div className="text-3xl font-bold text-navy mt-1">{projects}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs uppercase text-slate-400">Form templates</div>
            <div className="text-3xl font-bold text-navy mt-1">{msCount + fypCount}</div>
            <div className="text-xs text-teal-700 mt-1">
              MS {msCount} · FYP {fypCount}
            </div>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/admin/activity" className="card p-5 hover:border-teal-400 block md:col-span-2">
            <div className="text-xs uppercase text-slate-400">Monitoring</div>
            <h2 className="font-semibold text-navy text-lg">Activity monitor</h2>
            <p className="text-sm text-slate-600 mt-1">
              How many students and faculty visited today (PKT), who they are, page views, and a searchable,
              exportable log of every action and failed sign-in.
            </p>
          </Link>
          <Link href="/admin/users" className="card p-5 hover:border-teal-400 block">
            <h2 className="font-semibold text-navy text-lg">Users</h2>
            <p className="text-sm text-slate-600 mt-2">
              Add or remove <strong>faculty</strong>, <strong>students</strong>, and{" "}
              <strong>external examiners</strong>. New accounts show up on the login picker.
            </p>
          </Link>
          <Link href="/admin/departments" className="card p-5 hover:border-teal-400 block">
            <div className="text-xs uppercase text-slate-400">Organisation</div>
            <h2 className="font-semibold text-navy text-lg">Departments</h2>
            <p className="text-sm text-slate-600 mt-1">
              Add, rename, or remove department names shown in user forms and Excel import.
            </p>
          </Link>

          <Link href="/admin/forms" className="card p-5 hover:border-teal-400 block">
            <h2 className="font-semibold text-navy text-lg">Form name settings</h2>
            <p className="text-sm text-slate-600 mt-2">
              Edit display names for <strong>FYP</strong> and <strong>MS Thesis</strong> form
              stages. Internal codes stay stable; labels are what faculty and students see.
            </p>
          </Link>
          <div className="card p-5">
            <h2 className="font-semibold text-navy text-lg">Clear ideas &amp; projects</h2>
            <p className="text-sm text-slate-600 mt-2 mb-3">
              Remove all ideas, projects, interests, meetings, milestones, defences, documents,
              forms, signatures and GEC members. Users, form templates and the activity log stay.
            </p>
            <ClearIdeasProjectsButton />
          </div>
          <div className="card p-5">
            <h2 className="font-semibold text-navy text-lg">Full re-seed</h2>
            <p className="text-sm text-slate-600 mt-2 mb-3">
              Wipe the entire database and re-create default users and form templates (no demo
              ideas or projects).
            </p>
            <ReseedButton />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
