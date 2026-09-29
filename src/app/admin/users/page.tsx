import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { AdminUsersEditor } from "@/components/AdminUsersEditor";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminUsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <AppShell user={user}>
      <div className="space-y-4">
        <Link href="/admin" className="text-sm text-teal-700 hover:underline">
          ← Admin
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-navy">Users</h1>
          <p className="text-sm text-slate-500">
            Add or remove faculty, students, external examiners, and admins.
          </p>
        </div>
        <AdminUsersEditor />
      </div>
    </AppShell>
  );
}
