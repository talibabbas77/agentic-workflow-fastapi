import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER, SESSION_COOKIE } from "@/lib/session";

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

/**
 * Fast path for the admin app: no session cookie means a straight redirect to
 * log in. With a cookie, pass the path along so the layout can build the same
 * redirect if the API says the session is no longer valid.
 *
 * The platform admin console at /admin answers anyone who is not a signed-in
 * platform admin exactly as a page that does not exist: the same 404 page and
 * status, and no redirect to log in, so its existence is not revealed.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;
  const session = request.cookies.get(SESSION_COOKIE)?.value;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!session || !(await isPlatformAdmin(session))) {
      return NextResponse.rewrite(new URL("/_not-a-page", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

/** Asks the API, which decides: the flag and a verified email. Any failure keeps the console hidden. */
async function isPlatformAdmin(session: string) {
  try {
    const response = await fetch(`${API_INTERNAL_URL}/v1/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const me = (await response.json()) as { platform_admin?: boolean };
    return me.platform_admin === true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ["/app", "/app/:path*", "/admin", "/admin/:path*"],
};
