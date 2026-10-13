/// <reference types="node" />
// Phase 4 check 5: with third-party cookies blocked, the widget works.
// The page is the demo host by IP (127.0.0.1) and the widget is on localhost,
// so they are different sites and the widget is a third party there.
// Runs in Chromium with third-party cookies blocked and in WebKit, which blocks
// them by default. No chat model needed: asking for a person hands off at once.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, expect, type Frame, type Page } from "@playwright/test";
import {
  clickLauncher,
  fakeClientIp,
  hosts,
  openWidget,
  recordWidgetCalls,
  send,
  shape,
  widgetFrame,
  type WidgetCall,
} from "./support";

const test = base.extend<{ chatPage: Page }>({
  /** A page whose browser blocks third-party cookies. */
  chatPage: async ({ browser, browserName, playwright }, use) => {
    const extraHTTPHeaders = { "x-forwarded-for": fakeClientIp() };
    if (browserName !== "chromium") {
      const context = await browser.newContext({ extraHTTPHeaders });
      await use(await context.newPage());
      await context.close();
      return;
    }
    // Chromium has no launch flag for this; set the profile preference
    // "Block third-party cookies" in a fresh user data folder.
    const dir = mkdtempSync(join(tmpdir(), "docent-chromium-"));
    mkdirSync(join(dir, "Default"));
    writeFileSync(join(dir, "Default", "Preferences"), JSON.stringify({ profile: { cookie_controls_mode: 1 } }));
    const context = await playwright.chromium.launchPersistentContext(dir, {
      channel: "chromium",
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders,
    });
    await use(context.pages()[0] ?? (await context.newPage()));
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  },
});

test.use({ extraHTTPHeaders: { "x-forwarded-for": fakeClientIp() } });

interface Chat {
  calls: WidgetCall[];
  frame: Frame;
}

interface Handoff extends Chat {
  conversation: string;
}

/** Open the demo host page and the widget with the launcher. Nothing is sent yet. */
async function openChat(page: Page, origin: string, browserName: string): Promise<Chat> {
  const calls = recordWidgetCalls(page.context());
  await page.goto(`${origin}/lumen-notes`);
  await clickLauncher(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".greeting")).toHaveText("Hi, ask me anything about Lumen Notes.");

  // Focus moves into the panel, checked inside the frame. Chromium puts it in
  // the message field (headless Chromium reports no window focus, so check the
  // active element). WebKit focuses the panel but refuses script focus on a
  // field in a cross-site frame the visitor has not interacted with yet.
  if (browserName === "chromium") {
    await expect.poll(() => frame.evaluate(() => document.activeElement?.tagName)).toBe("TEXTAREA");
  } else {
    await expect.poll(() => frame.evaluate(() => document.hasFocus())).toBe(true);
  }
  // Opening creates nothing on the server.
  expect(shape(calls)).toEqual([]);
  return { calls, frame };
}

/** Ask for a person and leave an email. */
async function askForHuman({ calls, frame }: Chat): Promise<Handoff> {
  const email = `visitor-${Date.now().toString(36)}@example.com`;
  await send(frame, "I want to talk to a human");
  await expect(frame.locator(".msg.agent .note")).toContainText("A person from the team will follow up.");
  await expect(frame.locator(".msg.visitor")).toHaveText(/I want to talk to a human/);
  expect(shape(calls)).toEqual([
    "POST /v1/widget/sessions",
    "POST /v1/widget/conversations",
    "POST /v1/widget/conversations/:id/messages",
  ]);
  // The first message creates the conversation (create defaults to true).
  expect(calls[1].body).toEqual({});

  await frame.getByLabel("Where should the team reply?").fill(email);
  await frame.locator("form.contact").getByRole("button", { name: "Send" }).click();
  await expect(frame.locator(".done")).toHaveText(`Thanks. The team will reply to ${email}.`);
  expect(calls.at(-1)).toMatchObject({ method: "POST", body: { email }, status: 204 });
  return { calls, frame, conversation: calls[2].path.split("/")[4] };
}

/** After a reload the thread comes back, and the team already has the email. */
async function expectResumed(page: Page, { calls, conversation }: Handoff): Promise<void> {
  calls.length = 0;
  await page.reload();
  await openWidget(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".msg.visitor")).toHaveText(/I want to talk to a human/);
  await expect(frame.locator(".msg.agent .note")).toBeVisible();
  await expect(frame.locator("form.contact")).toHaveCount(0);
  expect(shape(calls)).toEqual(["POST /v1/widget/sessions", "POST /v1/widget/conversations"]);
  expect(calls[0].body).toMatchObject({ visitor_id: expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/) });
  // Opening only looks up history; it never creates a conversation.
  expect(calls[1].body).toEqual({ resume_id: conversation, create: false });
}

test("check 5: anonymous chat and handoff work with third-party cookies blocked", async ({ chatPage: page, browserName }) => {
  const { thirdPartyHost } = hosts();
  const chat = await openChat(page, thirdPartyHost, browserName);

  // Precondition: the browser refuses the widget's cookies on this page.
  const access = await chat.frame.evaluate(() => {
    document.cookie = "docent_probe=1; SameSite=None; Secure; Path=/";
    let storage = true;
    try {
      sessionStorage.setItem("docent_probe", "1");
      sessionStorage.removeItem("docent_probe");
    } catch {
      storage = false;
    }
    return { cookiesBlocked: document.cookie === "", storage };
  });
  if (browserName === "chromium") {
    // The profile setting must work, or this test proves nothing.
    expect(access.cookiesBlocked, "third-party cookies should be blocked").toBe(true);
    // Chromium blocks third-party storage along with the cookies.
    expect(access.storage).toBe(false);
  } else if (!access.cookiesBlocked) {
    // Some WebKit builds (for example on Linux) accept third-party cookies, so
    // there is nothing to prove here.
    const reason = `This ${browserName} build accepts third-party cookies, so check 5 cannot run in it.`;
    test.info().annotations.push({ type: "skipped", description: reason });
    test.skip(true, reason);
  }

  const flow = await askForHuman(chat);

  if (access.storage) {
    // WebKit gives the frame partitioned sessionStorage: the thread survives a reload.
    await expectResumed(page, flow);
    return;
  }
  // No storage at all: a reload starts a fresh, working chat instead of resuming.
  test.info().annotations.push({
    type: "note",
    description: "Chromium blocks third-party sessionStorage with third-party cookies, so the thread does not survive a reload.",
  });
  flow.calls.length = 0;
  await page.reload();
  await openWidget(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".greeting")).toBeVisible();
  await expect(frame.locator(".msg.visitor")).toHaveCount(0);
  await expect(frame.locator(".state-title")).toHaveCount(0);
  expect(shape(flow.calls)).toEqual([]);
});

test("anonymous resume after a reload keeps the thread and the handoff email", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebKit covers resume in the check 5 test.");
  const { host } = hosts();
  const flow = await askForHuman(await openChat(page, host, browserName));
  await expectResumed(page, flow);
});
