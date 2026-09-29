export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public liveness check — reveals nothing about data. */
export async function GET() {
  return Response.json({ ok: true });
}
