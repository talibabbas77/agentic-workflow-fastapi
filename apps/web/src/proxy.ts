import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "docent_session";
const PATH_HEADER = "x-docent-path";

/**
 * Fast path for the admin app: no session cookie means a straight redirect to
 * log in. With a cookie, pass the path along so the layout can build the same
 * redirect if the API says the session is no longer valid.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;

  if (!request.cookies.has(SESSION_COOKIE)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
