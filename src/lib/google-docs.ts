/** Accept https Google Docs or Drive share/view links only. */
export function isGoogleDocsOrDriveUrl(raw: string): boolean {
  const s = (raw || "").trim();
  if (!s) return false;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return (
    host === "docs.google.com" ||
    host === "drive.google.com" ||
    host.endsWith(".docs.google.com") ||
    host.endsWith(".drive.google.com")
  );
}

export function normalizeGoogleUrl(raw: string): string {
  return (raw || "").trim();
}
