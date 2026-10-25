import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminCookieEdge } from "./lib/admin-cookie";

/**
 * Keep the dashboard behind the admin login. The device API (/api/v1), the
 * field app (/app) and the login page are excluded by the matcher. Every
 * dashboard page and server action also checks the session itself.
 */
export function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET ?? "";
  if (!verifyAdminCookieEdge(request.cookies.get(ADMIN_COOKIE_NAME)?.value, secret)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/v1|app|login|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
