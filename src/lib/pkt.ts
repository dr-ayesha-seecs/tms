/** Asia/Karachi (PKT, UTC+5, no DST) helpers. */
export const PKT_OFFSET_MS = 5 * 3600 * 1000;
const DAY = 86400000;

/** Parse a stored date/time. Date-only => all-day in PKT; zone-less datetime => PKT. */
export function parsePkt(raw: string | null | undefined): { date: Date; allDay: boolean } | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00+05:00`);
    return Number.isNaN(d.getTime()) ? null : { date: d, allDay: true };
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const d = new Date(hasZone ? s : `${s.length === 16 ? s + ":00" : s}+05:00`);
  return Number.isNaN(d.getTime()) ? null : { date: d, allDay: false };
}

/** PKT calendar day number (days since epoch in PKT). */
export function pktDay(d: Date): number {
  return Math.floor((d.getTime() + PKT_OFFSET_MS) / DAY);
}

export function daysUntilPkt(target: Date, now = new Date()): number {
  return pktDay(target) - pktDay(now);
}

export function pktDateKey(now = new Date()): string {
  return new Date(now.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

export function fmtPkt(d: Date, allDay = false): string {
  const opts: Intl.DateTimeFormatOptions = allDay
    ? { timeZone: "Asia/Karachi", weekday: "short", day: "numeric", month: "short", year: "numeric" }
    : {
        timeZone: "Asia/Karachi",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      };
  return d.toLocaleString("en-PK", opts) + (allDay ? "" : " PKT");
}

/** datetime-local value (interpreted as PKT) -> ISO with +05:00 offset. */
export function localInputToPktIso(v: string): string {
  if (!v) return v;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) return v;
  return `${v.length === 16 ? v + ":00" : v}+05:00`;
}
