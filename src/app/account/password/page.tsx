import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams?: { forced?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const forced = searchParams?.forced === "1" || Number(user.must_change_password) === 1;

  const body = (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">
          {forced ? "Set a new password" : "Change password"}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {forced
            ? "For your privacy you must choose a new password before continuing."
            : "Update the password for your TMS account."}
        </p>
      </div>
      <ChangePasswordForm forced={forced} />
    </div>
  );

  if (forced) {
    // Minimal chrome while forced — still show branding via AppShell
    return <AppShell user={user}>{body}</AppShell>;
  }
  return <AppShell user={user}>{body}</AppShell>;
}
