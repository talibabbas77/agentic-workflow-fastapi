import { createApiClient } from "@docent/api-client";
import { hardNavigate } from "../navigation";

/**
 * Browser client. Every request goes to /api on this origin and Next rewrites it
 * to the API, so the session cookie stays first-party.
 */
export const api = createApiClient({ baseUrl: "/api" });

/** Send the visitor to the log in page and bring them back here afterwards. */
export function redirectToLogin() {
  const here = `${window.location.pathname}${window.location.search}`;
  hardNavigate(`/login?next=${encodeURIComponent(here)}`);
}
