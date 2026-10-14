import { execFileSync } from "node:child_process";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { uniqueEmail, waitForLink } from "./mailpit";
import { signUp } from "./signup";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "correct horse battery";
const API_DIR = path.join(__dirname, "..", "..", "api");

/*
 * The platform admin console at /admin, for Docent's own operators. The only
 * way to make an account a platform admin is the command line, so this runs
 * `docent admin grant` against the same database as the API under test (set
 * DATABASE_URL when that is not the local default).
 */

/** A new account with a verified email, signed in on this page, granted the console from the CLI. */
async function platformAdmin(page: Page) {
  const email = uniqueEmail("operator");
  // A made-up client address, as in signup.ts: signups are limited per address.
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const signup = await page.request.post("/api/v1/auth/signup", {
    headers: { origin: BASE, "x-forwarded-for": ip },
    data: { name: "Ops Person", email, password: PASSWORD, workspace_name: `Docent HQ ${Date.now().toString(36)}` },
  });
  expect(signup.status(), await signup.text()).toBe(201);
  const token = new URL(await waitForLink(email, "/verify-email?token=")).searchParams.get("token");
  const verified = await page.request.post("/api/v1/auth/verify-email", { headers: { origin: BASE }, data: { token } });
  expect(verified.status()).toBe(204);
  const said = execFileSync("uv", ["run", "--directory", API_DIR, "docent", "admin", "grant", email], {
    encoding: "utf8",
    env: process.env,
  });
  expect(said).toContain(`${email} is a platform admin`);
  return email;
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

test("the console answers everyone but a platform admin as a page that does not exist", async ({ page }) => {
  const unknown = await page.goto("/no-such-page");
  expect(unknown?.status()).toBe(404);

  // Signed out: no redirect to log in, just the 404 page.
  const signedOut = await page.goto("/admin/workspaces");
  expect(signedOut?.status()).toBe(404);
  await expect(page).toHaveURL(/\/admin\/workspaces$/);
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();

  // A workspace owner is no different.
  await signUp(page, "Ada Lovelace", "Ordinary Co");
  expect((await page.goto("/admin"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
  const api = await page.request.get("/api/v1/admin/overview");
  const nothing = await page.request.get("/api/v1/no-such-thing");
  expect(api.status()).toBe(404);
  expect((await api.json()).error.message).toBe((await nothing.json()).error.message);

  await page.goto("/app");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Platform admin" })).toHaveCount(0);
});

test("a platform admin finds a workspace, extends its trial, comps it, and ends the comp", async ({ page, browser }) => {
  // A customer, signed in on their own browser.
  const customerContext = await browser.newContext({ baseURL: BASE });
  const customer = await customerContext.newPage();
  const customerEmail = await signUp(customer, "Grace Hopper", "Customer Co");

  await platformAdmin(page);
  await page.goto("/app");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("link", { name: "Platform admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("banner")).toContainText("Admin console");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(page.getByText("Counts and metadata only.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Workspaces by plan and status" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Find the customer's workspace by its owner's email.
  await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: "Workspaces" }).click();
  await expect(page.getByRole("heading", { name: "Workspaces", level: 1 })).toBeVisible();
  await page.getByRole("searchbox").fill(customerEmail);
  await page.getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(/q=/);
  const results = page.getByRole("region", { name: "Workspaces" });
  await expect(results.getByRole("link", { name: /^Customer Co/ })).toHaveCount(1);
  await results.getByRole("link", { name: /^Customer Co/ }).click();

  await expect(page.getByRole("heading", { name: /^Customer Co/, level: 1 })).toBeVisible();
  const audit = page.getByRole("region", { name: "Recent audit entries" });
  await expect(audit).toContainText("Opened in the admin console");
  const subscription = page.getByRole("region", { name: "Subscription" });
  await expect(subscription).toContainText("Trial");
  expect(await seriousViolations(page)).toEqual([]);

  // Extend the trial by ten days, with a reason.
  await page.getByRole("button", { name: "Extend trial" }).click();
  const trial = page.getByRole("dialog", { name: "Extend the trial" });
  await trial.getByLabel("Days to add").fill("10");
  await trial.getByRole("button", { name: "Extend by 10 days" }).click();
  await expect(trial.getByText("Say why, in a few words.")).toBeVisible();
  await trial.getByLabel("Reason").fill("Asked for more time to test");
  await trial.getByRole("button", { name: "Extend by 10 days" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Trial extended");
  await expect(trial).toBeHidden();
  await expect(audit).toContainText("Trial extended");
  await expect(audit).toContainText("Asked for more time to test");

  // Give Scale at no charge.
  await page.getByRole("button", { name: "Give comped plan" }).click();
  const comp = page.getByRole("dialog", { name: "Give a comped plan" });
  await comp.getByLabel("Plan").selectOption("scale");
  await comp.getByLabel("Reason").fill("Design partner");
  await comp.getByRole("button", { name: /^Give Scale until / }).click();
  await expect(comp).toBeHidden();
  await expect(subscription).toContainText("Comped");
  await expect(subscription).toContainText("Scale");

  // The customer sees the plan Docent gave them.
  await customer.goto("/app/billing");
  await expect(customer.getByTestId("plan-status")).toHaveText(/^Free until /);
  await expect(customer.getByRole("region", { name: "Current plan" })).toContainText("No charge, given by Docent");

  // End it again.
  await page.getByRole("button", { name: "End comped plan" }).click();
  const end = page.getByRole("dialog", { name: /End the comped Scale plan/ });
  await end.getByLabel("Reason").fill("Partnership over");
  await end.getByRole("button", { name: "End comped plan" }).click();
  await expect(end).toBeHidden();
  await expect(subscription).toContainText("Canceled");
  await expect(page.getByRole("button", { name: "End comped plan" })).toBeDisabled();
  await customer.reload();
  await expect(customer.getByText("Escalate-only mode", { exact: true })).toBeVisible();

  // People: the customer, their workspace, and their role.
  await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: "People" }).click();
  await page.getByRole("searchbox").fill(customerEmail);
  await page.getByRole("searchbox").press("Enter");
  const people = page.getByRole("region", { name: "People" });
  await expect(people).toContainText(customerEmail);
  await expect(people).toContainText("Owner");
  await expect(people).toContainText("Email not verified");

  // Jobs and billing events open.
  await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { name: "Jobs", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dead jobs" })).toBeVisible();
  await page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: "Billing events" }).click();
  await expect(page.getByRole("heading", { name: "Billing events", level: 1 })).toBeVisible();

  // And back to the app.
  await page.getByRole("link", { name: "Back to the app" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await customerContext.close();
});
