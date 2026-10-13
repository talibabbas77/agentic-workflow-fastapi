import { createApiClient } from "@docent/api-client";
import { hardNavigate } from "../navigation";
import { settle, type FetchOutcome, type Result } from "./result";

/**
 * Browser client. Every request goes to /api on this origin and Next rewrites it
 * to the API, so the session cookie stays first-party.
 */
export const api = createApiClient({ baseUrl: "/api" });

/**
 * Settle a call made by a signed-in page. A 401 means the session ended, so it
 * sends the visitor to log in and back here afterwards; callers never see it.
 */
export async function request<T>(call: Promise<FetchOutcome<T>>): Promise<Result<T>> {
  const result = await settle(call);
  if (result.status === 401) {
    return hardNavigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  return result;
}

export async function logOut(next = "/login") {
  await settle(api.POST("/v1/auth/logout"));
  return hardNavigate(next);
}
