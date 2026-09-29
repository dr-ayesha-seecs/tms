import { NextResponse, type NextRequest } from "next/server";

/**
 * Defence in depth: nothing in the app is readable without a session cookie.
 * Each route/page still verifies the signed session itself (signature + expiry + user exists);
 * this only short-circuits requests that carry no session cookie at all.
 * Public: login page "/", login/logout endpoints, static assets, icons and the logo.
 */
const SESSION_COOKIE = "tms_session";
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout", "/api/health"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/" || PUBLIC_API.has(pathname)) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and static files (anything with a file extension, e.g. /mnsuam-logo.png, /icon.png)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
