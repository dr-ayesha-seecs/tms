"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";

export function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed");
      if (data.must_change_password) {
        router.push("/account/password?forced=1");
      } else {
        router.push("/dashboard");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy via-navy-light to-mns-blue flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <Image
              src="/mnsuam-logo.png"
              alt="MNSUAM"
              width={88}
              height={88}
              className="mx-auto rounded-full bg-white p-1 shadow"
              priority
            />
            <h1 className="mt-4 text-2xl font-bold text-white">MNSUAM Thesis TMS</h1>
            <p className="text-sm text-white/80 mt-1">
              MNS University of Agriculture, Multan
            </p>
          </div>

          <form onSubmit={onSubmit} className="card p-6 space-y-4 shadow-xl">
            <h2 className="font-semibold text-navy text-lg">Sign in</h2>
            {error && (
              <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
                {error}
              </p>
            )}
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="btn-primary w-full" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p className="text-xs text-slate-500 text-center">
              Forgot password? Contact the TMS admin.
            </p>
          </form>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
