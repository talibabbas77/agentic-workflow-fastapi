/// <reference types="node" />
// The panel's own controls on the demo host: suggested questions, New chat,
// Expand, text the host page puts in the message field, Recent chats for
// signed-in customers, and "Powered by Docent". No chat model needed: every
// message sent here asks for a person, which hands off at once.
import { expect, test, type Frame, type Page } from "@playwright/test";
import {
  SITE_URL,
  fakeClientIp,
  hosts,
  openWidget,
  recordWidgetCalls,
  send,
  shape,
  signInAsDiego,
  widgetFrame,
} from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": fakeClientIp() } });

/** The anonymous Lumen Notes site with the chat open. */
async function openLumen(page: Page): Promise<Frame> {
  await page.goto(`${hosts().host}/lumen-notes`);
  await openWidget(page);
  return widgetFrame(page);
}

/** The panel's inner size, which the loader sets on the iframe (1px border on each side). */
const panelSize = (frame: Frame) => frame.evaluate(() => [window.innerWidth, window.innerHeight]);

test("suggested questions show under the greeting; a click sends one; New chat starts empty", async ({ page }) => {
  const calls = recordWidgetCalls(page.context());
  const frame = await openLumen(page);
  const suggestions = frame.getByRole("list", { name: "Suggested questions" });
  await expect(suggestions.getByRole("button")).toHaveText([
    "How do I export a note as a PDF?",
    "I want to talk to a human",
  ]);
  expect(shape(calls)).toEqual([]);

  await suggestions.getByRole("button", { name: "I want to talk to a human" }).click();
  await expect(frame.locator(".msg.visitor")).toHaveText(/I want to talk to a human/);
  await expect(frame.locator(".msg.agent .note")).toContainText("A person from the team will follow up.");
  await expect(suggestions).toBeHidden();
  expect(shape(calls)).toEqual([
    "POST /v1/widget/sessions",
    "POST /v1/widget/conversations",
    "POST /v1/widget/conversations/:id/messages",
  ]);
  const first = calls[2].path.split("/")[4];

  // This chat has messages, so New chat asks first. Cancel keeps everything.
  const newChat = frame.getByRole("button", { name: "New chat" });
  const confirm = frame.getByRole("group", { name: /^Start a new chat\?/ });
  await newChat.click();
  await expect(confirm).toContainText("You will not be able to come back to this one.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(newChat).toBeFocused();
  await expect(frame.locator(".msg.visitor")).toHaveCount(1);

  await newChat.click();
  await confirm.getByRole("button", { name: "Start new chat" }).click();
  await expect(frame.locator(".msg.visitor")).toHaveCount(0);
  await expect(frame.locator(".greeting")).toHaveText("Hi, ask me anything about Lumen Notes.");
  await expect(suggestions.getByRole("button")).toHaveCount(2);
  await expect(frame.locator("textarea")).toBeFocused();

  // Nothing is created until the visitor writes, and then it is a new conversation.
  calls.length = 0;
  await send(frame, "I want to talk to a human");
  await expect(frame.locator(".msg.agent .note")).toBeVisible();
  expect(shape(calls)).toEqual(["POST /v1/widget/conversations", "POST /v1/widget/conversations/:id/messages"]);
  expect(calls[0].body).toEqual({ new: true });
  expect(calls[1].path.split("/")[4]).not.toBe(first);
});

test("Expand makes the panel larger and back, and the choice lasts for the visit", async ({ page }) => {
  const frame = await openLumen(page);
  const expand = frame.getByRole("button", { name: "Expand chat" });
  await expect(expand).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => panelSize(frame)).toEqual([378, 598]);

  await expand.click();
  await expect(expand).toHaveAttribute("aria-pressed", "true");
  // 720 wide and 85% of the 720px tall window.
  await expect.poll(() => panelSize(frame)).toEqual([718, 610]);

  // The next page in this tab opens expanded too.
  await page.reload();
  await openWidget(page);
  const again = await widgetFrame(page);
  const collapse = again.getByRole("button", { name: "Expand chat" });
  await expect(collapse).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => panelSize(again)).toEqual([718, 610]);
  await collapse.press("Enter");
  await expect(collapse).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => panelSize(again)).toEqual([378, 598]);
});

test("on a phone the panel is full screen and has no Expand button", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "x-forwarded-for": fakeClientIp() },
  });
  const frame = await openLumen(await context.newPage());
  await expect(frame.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(frame.getByRole("button", { name: "Expand chat" })).toHaveCount(0);
  expect(await panelSize(frame)).toEqual([390, 844]);
  await context.close();
});

test("Powered by Docent links to the Docent site in a new tab", async ({ page }) => {
  const frame = await openLumen(page);
  const link = frame.getByRole("link", { name: "Powered by Docent (opens in a new tab)" });
  await expect(link).toHaveAttribute("href", new URL(SITE_URL).href);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("Docent.open({ prefill }) fills the message field and never sends", async ({ page, browserName }) => {
  const calls = recordWidgetCalls(page.context());
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  await page.goto(`${hosts().host}/lumen-notes`);
  await openWidget(page, "How do I export a note as a PDF?");
  const frame = await widgetFrame(page);
  const input = frame.locator("textarea");
  await expect(input).toHaveValue("How do I export a note as a PDF?");
  // WebKit refuses script focus in a frame the visitor has not used yet.
  if (browserName === "chromium") await expect(input).toBeFocused();

  // Too long: ignored with a warning; the chat stays as it was.
  await openWidget(page, "x".repeat(1001));
  await expect.poll(() => warnings).toContain("Docent: prefill must be text of at most 1000 characters.");
  await expect(input).toHaveValue("How do I export a note as a PDF?");

  // The showcase's "Try asking" buttons use it, after the loader has arrived.
  await page.getByRole("button", { name: /How many devices can I use on the Free plan\?/ }).click();
  await expect(input).toHaveValue("How many devices can I use on the Free plan?");
  await expect(page.locator(".try-status").first()).toHaveText(
    "The question is in the chat box. Press Enter to send it.",
  );

  // Nothing was sent, and nothing was created on the server.
  await page.waitForTimeout(500);
  expect(shape(calls)).toEqual([]);
});

test("Recent chats: a signed-in customer reopens an earlier chat; anonymous visitors have none", async ({
  page,
}) => {
  const lumen = await openLumen(page);
  await expect(lumen.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(lumen.getByRole("button", { name: "Recent chats" })).toHaveCount(0);

  const calls = recordWidgetCalls(page.context());
  await signInAsDiego(page);
  await openWidget(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".sub")).toHaveText("Signed in as Diego Ramos");

  // Start from an empty chat (an earlier test may have left one open), then write.
  await frame.getByRole("button", { name: "New chat" }).click();
  const confirm = frame.getByRole("group", { name: /^Start a new chat\?/ });
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Start new chat" }).click();
  await expect(frame.locator(".msg.visitor")).toHaveCount(0);
  const question = `I want to talk to a human about label PW-${Date.now().toString().slice(-6)}`;
  await send(frame, question);
  await expect(frame.locator(".msg.agent .note")).toHaveText("A person from the team will follow up by email.");

  await frame.getByRole("button", { name: "New chat" }).click();
  await expect(confirm).toContainText("You can come back to this one from Recent chats.");
  await confirm.getByRole("button", { name: "Start new chat" }).click();
  await expect(frame.locator(".msg.visitor")).toHaveCount(0);

  const recent = frame.getByRole("button", { name: "Recent chats" });
  await recent.click();
  await expect(recent).toHaveAttribute("aria-pressed", "true");
  const list = frame.getByRole("list", { name: "Recent chats" });
  const item = list.getByRole("button", { name: new RegExp(question) });
  await expect(item).toContainText("With the team");
  await expect(list.getByRole("button").first()).toContainText(question);

  calls.length = 0;
  await item.click();
  await expect(frame.locator(".msg.visitor")).toHaveText([new RegExp(question)]);
  await expect(recent).toHaveAttribute("aria-pressed", "false");
  expect(shape(calls)).toEqual(["GET /v1/widget/conversations/:id"]);
  const opened = calls[0].path.split("/")[4];

  // Not closed, so it can be continued right here.
  await send(frame, "I want to talk to a human, please");
  await expect(frame.locator(".msg.visitor")).toHaveCount(2);
  expect(shape(calls).at(-1)).toBe("POST /v1/widget/conversations/:id/messages");
  expect(calls.at(-1)?.path.split("/")[4]).toBe(opened);
});
