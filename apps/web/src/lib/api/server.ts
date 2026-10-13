import { createApiClient, type paths } from "@docent/api-client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { PATH_HEADER, SESSION_COOKIE } from "../session";
import { settle, type Result } from "./result";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";

type GetPath = "/v1/auth/me" | "/v1/onboarding" | "/v1/tenant" | "/v1/members";
type GetData<P extends GetPath> = paths[P]["get"]["responses"][200]["content"]["application/json"];

/**
 * API client for Server Components. Forwards only the session cookie, never the
 * rest of the browser's cookies.
 */
async function serverApi() {
  // API calls are per request and per user; never run them while prerendering.
  await connection();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return createApiClient({
    baseUrl: API_INTERNAL_URL,
    headers: session ? { cookie: `${SESSION_COOKIE}=${session}` } : {},
    fetch: (input) => fetch(input, { cache: "no-store" }),
  });
}

/** GET a path. A 401 redirects to log in and back to the current page. */
async function get<P extends GetPath>(path: P): Promise<Result<GetData<P>>> {
  const client = await serverApi();
  // None of these paths take parameters; widening to the union lets openapi-fetch type the call.
  const result = (await settle(client.GET(path as GetPath))) as Result<GetData<P>>;
  if (result.status === 401) {
    const here = (await headers()).get(PATH_HEADER);
    redirect(here ? `/login?next=${encodeURIComponent(here)}` : "/login");
  }
  return result;
}

/** GET a path that should always succeed; any other failure goes to the error boundary. */
async function getOrThrow<P extends GetPath>(path: P): Promise<GetData<P>> {
  const result = await get(path);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** The signed-in user, read once per request. */
export const getMe = cache(() => getOrThrow("/v1/auth/me"));

export const getOnboarding = () => getOrThrow("/v1/onboarding");

export const getTenant = () => getOrThrow("/v1/tenant");

/** Members and invitations, or a 403 result for agents. */
export const getMembers = () => get("/v1/members");
