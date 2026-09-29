import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { LoginClient } from "@/components/LoginClient";

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) {
    if (Number(user.must_change_password) === 1) redirect("/account/password?forced=1");
    redirect("/dashboard");
  }
  return <LoginClient />;
}
