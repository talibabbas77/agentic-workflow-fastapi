/// <reference types="node" />
// Identified mode on the demo host's signed-in site (Parcelwise): the site signs
// a customer in with its own login, and its server signs the identity token the
// widget passes to Docent. Signed out, the site has no chat at all.
import { expect, test, type Page } from "@playwright/test";
import { closeWidget, fakeClientIp, hosts, openWidget, recordWidgetCalls, send, shape, widgetFrame } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": fakeClientIp() } });

const APP = "/parcelwise";

/** Signs in on the demo host through its own form, as Diego (Starter plan). */
async function signInAsDiego(page: Page): Promise<void> {
  const { host } = hosts();
  await page.goto(`${host}${APP}`);
  await page.getByRole("button", { name: /Sign in as Diego Ramos/ }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("signed out, the signed-in site shows no widget and signs no token", async ({ page, request }) => {
  const { host } = hosts();
  const calls = recordWidgetCalls(page.context());
  const loaderRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/widget/v1/")) loaderRequests.push(req.url());
  });

  await page.goto(`${host}${APP}`);
  await expect(page.getByRole("heading", { name: "Sign in to Parcelwise" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign in as / })).toHaveCount(3);
  // Give an idle-time mount every chance to happen, then check nothing did.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  expect(
    await page.evaluate(() => ({
      api: typeof (window as unknown as { Docent?: unknown }).Docent,
      launcher: document.querySelector("docent-widget") !== null,
      loader: document.querySelector('script[src*="/widget/v1/loader.js"]') !== null,
    })),
  ).toEqual({ api: "undefined", launcher: false, loader: false });
  expect(loaderRequests).toEqual([]);
  expect(shape(calls)).toEqual([]);
  expect((await request.get(`${host}${APP}/docent-token`)).status()).toBe(401);
});

test("identified: a signed-in customer is handed off without being asked for an email", async ({ page }) => {
  const calls = recordWidgetCalls(page.context());
  await signInAsDiego(page);
  await openWidget(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".sub")).toHaveText("Signed in as Diego Ramos");
  // The session carried the signed token; the conversation resumes on open.
  expect(calls[0]).toMatchObject({ path: "/v1/widget/sessions", status: 201 });
  expect((calls[0].body as { token?: string }).token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  await expect.poll(() => shape(calls)).toContain("POST /v1/widget/conversations");

  await send(frame, "I want to talk to a human");
  const note = frame.locator(".msg.agent .note").last();
  await expect(note).toHaveText("A person from the team will follow up by email.");
  await expect(frame.locator("form.contact")).toHaveCount(0);
});

test("check 10: await Docent.reset() on sign-out revokes the session before the page navigates", async ({ page }) => {
  await signInAsDiego(page);
  await openWidget(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".sub")).toHaveText("Signed in as Diego Ramos");

  // Order every relevant network event as it happens.
  const events: string[] = [];
  page.context().on("response", (res) => {
    const url = new URL(res.url());
    if (res.request().method() === "DELETE" && url.pathname === "/v1/widget/sessions/current") {
      events.push(`revoked ${res.status()}`);
    }
  });
  page.context().on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === `${APP}/sign-out`) events.push("sign-out");
  });

  // Close the panel (it can cover the page), then sign out. The site's
  // sign-out handler runs `await Docent.reset()`, then submits.
  await closeWidget(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: /Sign in as Diego Ramos/ })).toBeVisible();
  expect(events).toEqual(["revoked 204", "sign-out"]);
  // Back on the sign-in page, the chat is gone.
  expect(await page.evaluate(() => document.querySelector("docent-widget") !== null)).toBe(false);
});

test.describe("with a chat model", () => {
  // A real model can still hand off now and then; one retry keeps this stable.
  test.describe.configure({ retries: 1 });

  test("check 1: 'what plan am I on' is answered from the verified account", async ({ page }) => {
    test.skip(process.env.E2E_CHAT_MODEL !== "1", "Needs a chat model. Set E2E_CHAT_MODEL=1 to run.");
    test.setTimeout(150_000);
    await signInAsDiego(page);
    await openWidget(page);
    const frame = await widgetFrame(page);
    await expect(frame.locator(".sub")).toHaveText("Signed in as Diego Ramos");
    const before = await frame.locator(".msg.agent:not(.greeting)").count();
    await send(frame, "What plan am I on?");
    const reply = frame.locator(".msg.agent:not(.greeting)").nth(before);
    await expect(reply.locator(".bubble")).toContainText("Starter", { timeout: 120_000 });
    await expect(reply.locator(".from-account")).toHaveText("From your account");
  });
});
