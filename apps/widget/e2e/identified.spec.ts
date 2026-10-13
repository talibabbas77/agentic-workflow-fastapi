/// <reference types="node" />
// Identified mode on the demo host: the host signs in a visitor with its own
// login, and its server signs the identity token the widget passes to Docent.
import { expect, test, type Page } from "@playwright/test";
import { closeWidget, fakeClientIp, hosts, openWidget, recordWidgetCalls, send, shape, widgetFrame } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": fakeClientIp() } });

/** Signs in on the demo host through its own form, as Ben (Free plan). */
async function signInAsBen(page: Page): Promise<void> {
  const { host } = hosts();
  await page.goto(`${host}/lumen-notes`);
  await page.getByRole("button", { name: "Ben, Free" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("identified: a signed-in visitor is handed off without being asked for an email", async ({ page }) => {
  const calls = recordWidgetCalls(page.context());
  await signInAsBen(page);
  await openWidget(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".sub")).toHaveText("Signed in as Ben Carter");
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
  await signInAsBen(page);
  await openWidget(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".sub")).toHaveText("Signed in as Ben Carter");

  // Order every relevant network event as it happens.
  const events: string[] = [];
  page.context().on("response", (res) => {
    const url = new URL(res.url());
    if (res.request().method() === "DELETE" && url.pathname === "/v1/widget/sessions/current") {
      events.push(`revoked ${res.status()}`);
    }
  });
  page.context().on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/lumen-notes/sign-out") events.push("sign-out");
  });

  // Close the panel (it covers the host's header), then sign out. The demo
  // host's sign-out handler runs `await Docent.reset()`, then submits.
  await closeWidget(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Ben, Free" })).toBeVisible();
  expect(events).toEqual(["revoked 204", "sign-out"]);
});

test.describe("with a chat model", () => {
  // A real model can still hand off now and then; one retry keeps this stable.
  test.describe.configure({ retries: 1 });

  test("check 1: 'what plan am I on' is answered from the verified account", async ({ page }) => {
    test.skip(process.env.E2E_CHAT_MODEL !== "1", "Needs a chat model. Set E2E_CHAT_MODEL=1 to run.");
    test.setTimeout(150_000);
    await signInAsBen(page);
    await openWidget(page);
    const frame = await widgetFrame(page);
    await expect(frame.locator(".sub")).toHaveText("Signed in as Ben Carter");
    const before = await frame.locator(".msg.agent:not(.greeting)").count();
    await send(frame, "What plan am I on?");
    const reply = frame.locator(".msg.agent:not(.greeting)").nth(before);
    await expect(reply.locator(".bubble")).toContainText("Free", { timeout: 120_000 });
    await expect(reply.locator(".from-account")).toHaveText("From your account");
  });
});
