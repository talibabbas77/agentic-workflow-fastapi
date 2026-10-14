import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER, SESSION_COOKIE } from "@/lib/session";

/**
 * Fast path for the admin app: no session cookie means a straight redirect to
 * log in. With a cookie, pass the path along so the layout can build the same
 * redirect if the API says the session is no longer valid.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) return uncompressed(request);
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

/**
 * An agent turn streams Server-Sent Events through the /api rewrite. Next gzips
 * proxied responses, and gzip holds small events back until the stream ends, so
 * progress would arrive all at once. Asking for no compression keeps each event
 * live. The API marking the stream Cache-Control: no-transform would make this
 * unnecessary.
 */
function uncompressed(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("accept-encoding");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/app", "/app/:path*", "/api/v1/agent/conversations/:id/messages"],
};
