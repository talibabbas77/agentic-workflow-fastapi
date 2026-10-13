import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, request, test, type Browser } from "@playwright/test";
import { uniqueEmail, waitForLink } from "./mailpit";

/*
 * Visual review screenshots, light and dark, desktop and mobile.
 * Run with: SCREENSHOTS=1 SCREENSHOT_DIR=/some/dir pnpm e2e screens
 */

test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to capture review screenshots.");
test.describe.configure({ mode: "serial" });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SCREENSHOT_DIR ?? path.join(__dirname, "..", "test-results", "screens");
const PASSWORD = "correct horse battery";

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
const themes = ["light", "dark"] as const;

type Session = Awaited<ReturnType<Awaited<ReturnType<typeof request.newContext>>["storageState"]>>;

async function signUp(name: string, workspace: string) {
  const email = uniqueEmail(name.split(" ")[0]!.toLowerCase());
  const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  const response = await api.post("/api/v1/auth/signup", {
    data: { name, email, password: PASSWORD, workspace_name: workspace },
  });
  expect(response.status(), await response.text()).toBe(201);
  return { api, email };
}

let fresh: Session;
let established: Session;

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });

  // A brand new owner: unverified, so the overview shows the banner and the next step.
  const newcomer = await signUp("Ada Lovelace", "Acme Support");
  fresh = await newcomer.api.storageState();

  // An owner with a confirmed email, a teammate, and a pending invitation.
  const owner = await signUp("Margaret Hamilton", "Northwind Help Desk");
  const verifyLink = await waitForLink(owner.email, "/verify-email?token=");
  const token = new URL(verifyLink).searchParams.get("token")!;
  expect((await owner.api.post("/api/v1/auth/verify-email", { data: { token } })).ok()).toBeTruthy();

  const teammateEmail = uniqueEmail("grace");
  expect(
    (await owner.api.post("/api/v1/invitations", { data: { email: teammateEmail, role: "admin" } })).ok(),
  ).toBeTruthy();
  const inviteLink = await waitForLink(teammateEmail, "/invite?token=");
  const inviteToken = new URL(inviteLink).searchParams.get("token")!;
  const guest = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  const accepted = await guest.post("/api/v1/invitations/accept", {
    data: { token: inviteToken, name: "Grace Hopper", password: PASSWORD },
  });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  expect(
    (await owner.api.post("/api/v1/invitations", { data: { email: uniqueEmail("katherine"), role: "agent" } })).ok(),
  ).toBeTruthy();
  established = await owner.api.storageState();
});

async function shoot(
  browser: Browser,
  route: string,
  name: string,
  session: Session | undefined,
  settleMs = 900,
  act?: (page: import("@playwright/test").Page) => Promise<void>,
) {
  for (const theme of themes) {
    for (const [size, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({
        baseURL: BASE,
        viewport,
        colorScheme: theme,
        storageState: session,
        deviceScaleFactor: size === "mobile" ? 2 : 1,
      });
      const page = await context.newPage();
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(settleMs);
      if (act) {
        await act(page);
        await page.waitForTimeout(400);
      }
      await page.screenshot({ path: path.join(OUT, `${name}-${size}-${theme}.png`), fullPage: true });
      await context.close();
    }
  }
}

test("login", async ({ browser }) => {
  await shoot(browser, "/login", "login", undefined, 2300);
});

test("signup", async ({ browser }) => {
  await shoot(browser, "/signup", "signup", undefined, 3300);
});

test("overview", async ({ browser }) => {
  await shoot(browser, "/app", "overview", fresh);
});

test("overview-established", async ({ browser }) => {
  await shoot(browser, "/app", "overview-established", established);
});

test("members", async ({ browser }) => {
  await shoot(browser, "/app/settings/members", "members", established);
});

test("empty-state", async ({ browser }) => {
  await shoot(browser, "/app/knowledge", "knowledge", fresh);
});

test("invite-dialog", async ({ browser }) => {
  await shoot(browser, "/app/settings/members?invite=1", "invite-dialog", established);
});

test("workspace-menu", async ({ browser }) => {
  await shoot(browser, "/app/settings", "workspace-menu", established, 600, async (page) => {
    const trigger = page.getByRole("button", { name: /Switch workspace/ });
    if (!(await trigger.isVisible())) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: /Switch workspace/ }).click();
  });
});
