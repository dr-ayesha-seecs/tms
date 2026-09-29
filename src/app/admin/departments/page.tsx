import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { AdminDepartmentsEditor } from "@/components/AdminDepartmentsEditor";

export const dynamic = "force-dynamic";

export default async function AdminDepartmentsPage() {
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
          <h1 className="text-2xl font-bold text-navy">Departments</h1>
          <p className="text-sm text-slate-500">
            Manage the department list used when adding or importing users.
          </p>
        </div>
        <AdminDepartmentsEditor />
      </div>
    </AppShell>
  );
}
