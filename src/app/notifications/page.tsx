import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { NotificationsList } from "@/components/NotificationsList";
import { computeNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const list = await computeNotifications(user);
  return (
    <AppShell user={user}>
      <div className="space-y-4 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-navy">Notifications</h1>
          <p className="text-sm text-slate-500">
            Reminders are generated from current data. Dismissed pending-action reminders come back the next day while the action is still pending.
          </p>
        </div>
        <div className="card p-5">
          <NotificationsList initial={list} />
        </div>
      </div>
    </AppShell>
  );
}
