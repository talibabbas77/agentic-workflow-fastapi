import { createApiClient, type Me } from "@docent/api-client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { settle } from "./result";

export const SESSION_COOKIE = "docent_session";
export const PATH_HEADER = "x-docent-path";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";

/**
 * API client for Server Components. Forwards only the session cookie, never the
 * rest of the browser's cookies.
 */
export async function serverApi() {
  // API calls are per request and per user; never run them while prerendering.
  await connection();
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: API_INTERNAL_URL,
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
    fetch: (input) => fetch(input, { cache: "no-store" }),
  });
}

/** Where to send a visitor whose session is missing or expired. */
export async function loginPath() {
  const path = (await headers()).get(PATH_HEADER);
  return path ? `/login?next=${encodeURIComponent(path)}` : "/login";
}

/**
 * The signed-in user, read once per request. Redirects to /login when the
 * session is missing or no longer valid.
 */
export const getMe = cache(async (): Promise<Me> => {
  const client = await serverApi();
  const result = await settle(client.GET("/v1/auth/me"));
  if (result.ok) return result.data;
  if (result.status === 401) redirect(await loginPath());
  throw new Error(result.error.message);
});
