import { createApiClient, type ApiClient, type paths } from "@docent/api-client";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { PATH_HEADER, SESSION_COOKIE } from "../session";
import { settle, type FetchOutcome, type Result } from "./result";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";

type GetPath =
  | "/v1/auth/me"
  | "/v1/onboarding"
  | "/v1/tenant"
  | "/v1/members"
  | "/v1/knowledge/sources"
  | "/v1/agent/settings"
  | "/v1/ticket-types"
  | "/v1/widgets"
  | "/v1/public/plans"
  | "/v1/billing"
  | "/v1/memory"
  | "/v1/memory/answers"
  | "/v1/memory/gaps"
  | "/v1/memory/customers";
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

/** Make a call. A 401 redirects to log in and back to the current page. */
async function call<T>(send: (client: ApiClient) => Promise<FetchOutcome<T>>): Promise<Result<T>> {
  const result = await settle(send(await serverApi()));
  if (result.status === 401) {
    const here = (await headers()).get(PATH_HEADER);
    redirect(here ? `/login?next=${encodeURIComponent(here)}` : "/login");
  }
  return result;
}

async function get<P extends GetPath>(path: P): Promise<Result<GetData<P>>> {
  // None of these paths take parameters; widening to the union lets openapi-fetch type the call.
  return (await call((client) => client.GET(path as GetPath))) as Result<GetData<P>>;
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

export const getSources = () => getOrThrow("/v1/knowledge/sources");

export const getAgentSettings = () => getOrThrow("/v1/agent/settings");

export const getTicketTypes = () => getOrThrow("/v1/ticket-types");

export const getWidgets = () => getOrThrow("/v1/widgets");

export const getBilling = () => getOrThrow("/v1/billing");
/** The plan catalog, read fresh: the marketing pages' cached copy may hold a failed fetch from build time. */
export const getPlanCatalog = () => getOrThrow("/v1/public/plans");

export const getMemory = () => getOrThrow("/v1/memory");

export const getTeamAnswers = () => getOrThrow("/v1/memory/answers");

export const getGaps = () => getOrThrow("/v1/memory/gaps");

export const getRememberedCustomers = () => getOrThrow("/v1/memory/customers");

/** One widget. A missing widget, or an id that is not one, shows the 404 page. */
export async function getWidget(widgetId: string) {
  const result = await call((client) =>
    client.GET("/v1/widgets/{widget_id}", { params: { path: { widget_id: widgetId } } }),
  );
  if (result.status === 404 || result.status === 422) notFound();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** One source and its documents. A missing source, or an id that is not one, shows the 404 page. */
export async function getSource(sourceId: string) {
  const result = await call((client) =>
    client.GET("/v1/knowledge/sources/{source_id}", { params: { path: { source_id: sourceId } } }),
  );
  if (result.status === 404 || result.status === 422) notFound();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
