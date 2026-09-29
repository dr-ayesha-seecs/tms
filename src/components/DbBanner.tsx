import { getDbMode, isDurableDb } from "@/lib/db";

export function DbBanner() {
  if (isDurableDb()) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <strong className="font-semibold">Temporary database.</strong> Firebase Firestore is not
      configured, so changes are kept in a temporary copy and may be lost. Set{" "}
      <code className="text-xs">FIREBASE_SERVICE_ACCOUNT_BASE64</code> in the deployment&apos;s environment
      variables.
      <span className="block text-xs mt-1 text-amber-800">Mode: {getDbMode()}</span>
    </div>
  );
}
