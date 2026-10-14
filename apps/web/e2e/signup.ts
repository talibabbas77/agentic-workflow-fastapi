import { expect, type Page } from "@playwright/test";
import { uniqueEmail } from "./mailpit";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "correct horse battery";

/** A new owner of a new, empty workspace, signed in on this page. */
export async function signUp(page: Page, name: string, workspace: string) {
  const email = uniqueEmail(name.split(" ")[0]!.toLowerCase());
  const response = await page.request.post("/api/v1/auth/signup", {
    headers: { origin: BASE },
    data: { name, email, password: PASSWORD, workspace_name: `${workspace} ${Date.now().toString(36)}` },
  });
  expect(response.status(), await response.text()).toBe(201);
  return email;
}
