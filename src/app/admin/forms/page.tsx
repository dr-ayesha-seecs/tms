import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { AdminFormsEditor } from "@/components/AdminFormsEditor";


export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminFormsPage() {
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
          <h1 className="text-2xl font-bold text-navy">Form name settings</h1>
          <p className="text-sm text-slate-500">
            Separate naming for FYP and MS Thesis tracks. Projects use the display names for their{" "}
            <code className="text-xs">programType</code>.
          </p>
        </div>
        <AdminFormsEditor />
      </div>
    </AppShell>
  );
}
