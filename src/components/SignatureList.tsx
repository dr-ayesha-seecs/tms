import { formatDate } from "@/lib/format";
import type { Signature } from "@/lib/types";

export function SignatureList({
  signatures,
  pendingRoles,
}: {
  signatures: (Signature & { user_name?: string })[];
  pendingRoles?: string[];
}) {
  return (
    <div className="space-y-2">
      {signatures.map((s) => (
        <div key={s.id} className="flex items-start justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm">
          <div>
            <div className="font-medium text-emerald-900">
              {s.user_name || "Member"} · {s.role_label}
            </div>
            <div className="text-xs text-emerald-700">{formatDate(s.signed_at)}</div>
            {s.method === "typed" ? (
              <div className="mt-1 font-serif italic text-navy">{s.signature_data}</div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.signature_data} alt="signature" className="mt-1 h-10 bg-white rounded border" />
            )}
          </div>
          <span className="badge-success">Signed</span>
        </div>
      ))}
      {(pendingRoles || []).map((role) => (
        <div key={role} className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
          <span className="text-amber-900">{role}</span>
          <span className="badge-warning">Pending</span>
        </div>
      ))}
      {!signatures.length && !(pendingRoles || []).length && (
        <p className="text-sm text-slate-500">No signatures yet.</p>
      )}
    </div>
  );
}
