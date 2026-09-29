export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-PK", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) + " PKT";
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PK", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (["open", "active", "signed", "approved", "pass", "done", "completed", "proposal_passed", "final_passed", "in_house_passed"].includes(s))
    return "badge-success";
  if (["pending", "interest_pending", "pending_signatures", "acb_pending", "proposal_scheduled", "draft", "in_progress", "gec_forming"].includes(s))
    return "badge-warning";
  if (["rejected", "fail", "closed", "blocked", "withdrawn"].includes(s)) return "badge-danger";
  if (["converted", "research", "conditional_pass"].includes(s)) return "badge-info";
  return "badge-muted";
}
