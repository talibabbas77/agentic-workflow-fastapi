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
  | "/v1/tenant/timezones"
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
  | "/v1/memory/customers"
  | "/v1/inbox/assignees"
  | "/v1/inbox/settings"
  | "/v1/inbox/preferences"
  | "/v1/automation/rules"
  | "/v1/automation/channels"
  | "/v1/automation/webhooks"
  | "/v1/evals/sets"
  | "/v1/evals/documents"
  | "/v1/evals/calibration";
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

export const getTimezones = () => getOrThrow("/v1/tenant/timezones");

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

/**
 * The signed-in user when they may open the platform admin console. Anyone
 * else, signed in or not, gets the ordinary 404 page, as the API answers them,
 * so the console's existence is not revealed. No redirect to log in either.
 */
export const getPlatformAdmin = cache(async () => {
  const result = await settle((await serverApi()).GET("/v1/auth/me"));
  if (!result.ok || !result.data.platform_admin) notFound();
  return result.data;
});

/** A console read. The API answers 404 to anyone who is not a platform admin. */
async function adminCall<T>(send: (client: ApiClient) => Promise<FetchOutcome<T>>): Promise<T> {
  const result = await call(send);
  if (result.status === 404 || result.status === 422) notFound();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

type AdminQuery<P extends keyof paths> = paths[P] extends { get: { parameters: { query?: infer Q } } }
  ? NonNullable<Q>
  : never;

export const getAdminOverview = () => adminCall((client) => client.GET("/v1/admin/overview"));

export const getAdminWorkspaces = (query: AdminQuery<"/v1/admin/workspaces">) =>
  adminCall((client) => client.GET("/v1/admin/workspaces", { params: { query } }));

export const getAdminWorkspace = (tenantId: string) =>
  adminCall((client) =>
    client.GET("/v1/admin/workspaces/{tenant_id}", { params: { path: { tenant_id: tenantId } } }),
  );

export const getAdminPeople = (query: AdminQuery<"/v1/admin/people">) =>
  adminCall((client) => client.GET("/v1/admin/people", { params: { query } }));

export const getAdminJobs = () => adminCall((client) => client.GET("/v1/admin/jobs"));

export const getAdminBillingEvents = (query: AdminQuery<"/v1/admin/billing-events">) =>
  adminCall((client) => client.GET("/v1/admin/billing-events", { params: { query } }));

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

export const getAssignees = () => getOrThrow("/v1/inbox/assignees");

export const getInboxSettings = () => getOrThrow("/v1/inbox/settings");

export const getNotificationPrefs = () => getOrThrow("/v1/inbox/preferences");

export const getRoutingRules = () => getOrThrow("/v1/automation/rules");

export const getSlackChannels = () => getOrThrow("/v1/automation/channels");

export const getWebhooks = () => getOrThrow("/v1/automation/webhooks");

type InboxQuery = NonNullable<paths["/v1/inbox"]["get"]["parameters"]["query"]>;
type BoardQuery = NonNullable<paths["/v1/inbox/board"]["get"]["parameters"]["query"]>;

/** A page of the inbox for these filters. */
export async function getInbox(query: InboxQuery) {
  const result = await call((client) => client.GET("/v1/inbox", { params: { query } }));
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** The inbox as a board, by status. */
export async function getInboxBoard(query: BoardQuery) {
  const result = await call((client) => client.GET("/v1/inbox/board", { params: { query } }));
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** One handoff. A missing one, or an id that is not one, shows the 404 page. */
export async function getHandoff(escalationId: string) {
  const result = await call((client) =>
    client.GET("/v1/inbox/{escalation_id}", { params: { path: { escalation_id: escalationId } } }),
  );
  if (result.status === 404 || result.status === 422) notFound();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export const getEvalSets = () => getOrThrow("/v1/evals/sets");

export const getEvalDocuments = () => getOrThrow("/v1/evals/documents");

export const getCalibration = () => getOrThrow("/v1/evals/calibration");

/** One eval set with its cases and recent runs. A missing set shows the 404 page. */
export async function getEvalSet(setId: string) {
  const result = await call((client) =>
    client.GET("/v1/evals/sets/{set_id}", { params: { path: { set_id: setId } } }),
  );
  if (result.status === 404 || result.status === 422) notFound();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Runs of every set, newest first. */
export async function getEvalRuns() {
  const result = await call((client) => client.GET("/v1/evals/runs", { params: { query: {} } }));
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** One run and its results. A missing run shows the 404 page. */
export async function getEvalRun(runId: string) {
  const result = await call((client) =>
    client.GET("/v1/evals/runs/{run_id}", { params: { path: { run_id: runId } } }),
  );
  if (result.status === 404 || result.status === 422) notFound();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Two runs of one set side by side, or the API's reason they cannot be compared. */
export async function getComparison(a: string, b: string) {
  return call((client) => client.GET("/v1/evals/compare", { params: { query: { a, b } } }));
}

/** Widget traffic over the last `days` days. */
export async function getProductionMetrics(days: number) {
  const result = await call((client) => client.GET("/v1/evals/metrics", { params: { query: { days } } }));
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A week of the review queue; this week's fills itself on the way. */
export async function getReviewQueue(week?: string) {
  const result = await call((client) => client.GET("/v1/evals/review", { params: { query: week ? { week } : {} } }));
  if (result.status === 422) notFound();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** One conversation to grade. A missing one shows the 404 page. */
export async function getReviewItem(itemId: string) {
  const result = await call((client) =>
    client.GET("/v1/evals/review/{item_id}", { params: { path: { item_id: itemId } } }),
  );
  if (result.status === 404 || result.status === 422) notFound();
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
