import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER, SESSION_COOKIE } from "@/lib/session";

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

/**
 * Fast path for the admin app: no session cookie means a straight redirect to
 * log in. With a cookie, pass the path along so the layout can build the same
 * redirect if the API says the session is no longer valid.
 *
 * The platform admin console at /admin: signed-out visitors (or an expired
 * session) are sent to log in like any other page. A signed-in member who is not
 * a platform admin gets the same 404 page and status as a page that does not
 * exist, so the workspace app never reveals the console. If the API cannot be
 * reached, the answer is a 503 that says to try again, never the console.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const path = `${pathname}${search}`;
  const session = request.cookies.get(SESSION_COOKIE)?.value;

  const toLogin = () => {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  };

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const access = session ? await platformAccess(session) : "signed-out";
    if (access === "admin") return NextResponse.next();
    if (access === "signed-out") return toLogin();
    if (access === "unavailable") return unavailable();
    return NextResponse.rewrite(new URL("/_not-a-page", request.url));
  }

  if (!session) return toLogin();

  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

type Access = "admin" | "member" | "signed-out" | "unavailable";

/**
 * Asks the API, which decides: the flag and a verified email. One quick retry
 * covers an API restart; anything still failing keeps the console closed.
 */
async function platformAccess(session: string, attempt = 0): Promise<Access> {
  try {
    const response = await fetch(`${API_INTERNAL_URL}/v1/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      cache: "no-store",
    });
    if (response.status === 401) return "signed-out";
    if (!response.ok) throw new Error(`auth/me answered ${response.status}`);
    const me = (await response.json()) as { platform_admin?: boolean };
    return me.platform_admin === true ? "admin" : "member";
  } catch {
    if (attempt > 0) return "unavailable";
    await new Promise((resolve) => setTimeout(resolve, 400));
    return platformAccess(session, attempt + 1);
  }
}

/** A plain page in the house colors: the API is restarting or down. */
function unavailable() {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Try again in a moment</title><style>
:root{color-scheme:light dark;--paper:#f5f0e6;--ink:#1b1916;--muted:#5e574f;--rust:#b5431f}
@media (prefers-color-scheme:dark){:root{--paper:#161412;--ink:#f1ebe0;--muted:#b3aa9e;--rust:#e0673f}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:28rem;padding:24px}h1{margin:0 0 8px;font-size:1.5rem;letter-spacing:-0.01em}p{margin:0 0 16px;color:var(--muted)}a{color:var(--rust);cursor:pointer}
</style></head><body><main><h1>Docent is not answering right now</h1><p>The server may be restarting. Try again in a moment.</p><a href="">Try again</a></main></body></html>`;
  return new NextResponse(page, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "5" },
  });
}

export const config = {
  matcher: ["/app", "/app/:path*", "/admin", "/admin/:path*"],
};
