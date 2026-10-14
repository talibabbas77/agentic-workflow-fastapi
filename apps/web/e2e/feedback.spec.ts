import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { waitForLink } from "./mailpit";
import { signUp } from "./signup";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
/** The API itself, which also serves the widget: widget calls go there with its own Origin. */
const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const headers = { origin: BASE };

const GUIDE = `# Exporting notes

Open a note or notebook and select Export. Choose PDF, Markdown, or HTML.
PDF exports include comments. Markdown exports are a ZIP file with every note
and its attachments.
`;

async function verify(page: Page, email: string) {
  const token = new URL(await waitForLink(email, "/verify-email?token=")).searchParams.get("token")!;
  const verified = await page.request.post("/api/v1/auth/verify-email", { headers, data: { token } });
  expect(verified.status()).toBe(204);
}

/** A preview conversation where the customer asks for a person: a handoff, no model call. */
async function handoff(api: APIRequestContext, topic: string) {
  const conversation = await api.post("/api/v1/agent/conversations", { headers, data: {} });
  const { id } = (await conversation.json()) as { id: string };
  const sent = await api.post(`/api/v1/agent/conversations/${id}/messages`, {
    headers,
    data: { content: `Please let me talk to a person about ${topic}` },
  });
  expect(sent.ok()).toBeTruthy();
  const detail = (await (await api.get(`/api/v1/agent/conversations/${id}`)).json()) as { escalation: { id: string } };
  return detail.escalation.id;
}

/** Waits until routing has written `count` unread notifications for this member. */
async function unreadNotifications(api: APIRequestContext, count: number) {
  await expect
    .poll(
      async () => ((await (await api.get("/api/v1/notifications")).json()) as { unread: number }).unread,
      { timeout: 60_000 },
    )
    .toBe(count);
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

test("the Inbox badge and the bell show new handoffs; reading clears them", async ({ page }) => {
  const owner = await signUp(page, "Ada Lovelace", "Bell");
  await verify(page, owner);
  // Route every handoff to the owner by email, so they are told in the app too.
  const rule = await page.request.post("/api/v1/automation/rules", {
    headers,
    data: { name: "Ada hears", notify_emails: [owner] },
  });
  expect(rule.status(), await rule.text()).toBe(201);

  await page.goto("/app");
  const sidebar = page.getByRole("navigation", { name: "Main" });
  await expect(sidebar.getByRole("link", { name: "Inbox", exact: true })).toBeVisible();
  const bell = page.getByRole("button", { name: "Notifications", exact: true });
  await expect(bell).toBeVisible();

  const first = await handoff(page.request, "a refund for order 1042");
  await unreadNotifications(page.request, 1);
  await page.goto("/app");
  await expect(sidebar.getByRole("link", { name: "Inbox 1 unread" })).toBeVisible();
  const unreadBell = page.getByRole("button", { name: "Notifications, 1 unread" });
  await unreadBell.click();
  const popover = page.getByLabel("Notifications", { exact: true }).filter({ has: page.getByText("Mark all as read") });
  await expect(popover).toBeVisible();
  const item = popover.getByRole("link", { name: /New handoff\s?, unread/ });
  await expect(item).toBeVisible();
  expect(await seriousViolations(page), "serious or critical axe violations").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();

  // Following the notification opens the handoff, which reads it: badge and bell clear.
  await unreadBell.click();
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/app/inbox/${first}$`));
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Inbox", exact: true })).toBeVisible();

  // Two more: mark one as read from the bell, then the rest at once.
  await handoff(page.request, "my invoice");
  await handoff(page.request, "exporting notes");
  await unreadNotifications(page.request, 2);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
  await popover.getByRole("button", { name: "Mark as read: New handoff" }).first().click();
  await expect(page.getByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();
  await popover.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await expect(popover.getByRole("link", { name: /, unread/ })).toHaveCount(0);
  // The handoffs themselves stay unread until someone opens them.
  await expect(sidebar.getByRole("link", { name: "Inbox 2 unread" })).toBeVisible();
});

test("the workspace time zone decides when the daily digest goes out", async ({ page }) => {
  const owner = await signUp(page, "Ada Lovelace", "Zones");
  await verify(page, owner);
  await page.goto("/app/settings");
  const zone = page.getByRole("combobox", { name: "Time zone" });
  await expect(zone).toHaveValue("UTC");
  // The local time shows once the page is interactive.
  await expect(page.getByText(/The daily digest goes out at 08:00 here\. It is \d\d:\d\d there now\./)).toBeVisible();
  await zone.selectOption("Pacific/Auckland");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Workspace saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Time zone" })).toHaveValue("Pacific/Auckland");
  const tenant = (await (await page.request.get("/api/v1/tenant")).json()) as { timezone: string };
  expect(tenant.timezone).toBe("Pacific/Auckland");
});

test("the inbox transcript shows the customer's vote and note on an answer", async ({ page }) => {
  test.skip(process.env.E2E_CHAT_MODEL !== "1", "Needs a chat model for a real answer. Set E2E_CHAT_MODEL=1 to run.");
  test.setTimeout(150_000);
  const owner = await signUp(page, "Ada Lovelace", "Votes");
  await verify(page, owner);
  const upload = await page.request.post("/api/v1/knowledge/uploads", {
    headers,
    multipart: {
      file: { name: "exporting.md", mimeType: "text/markdown", buffer: Buffer.from(GUIDE) },
      audience: "public",
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const { id: sourceId } = (await upload.json()) as { id: string };
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/v1/knowledge/sources/${sourceId}`)).json()) as { source: { status: string } })
          .source.status,
      { timeout: 90_000 },
    )
    .toBe("ready");
  const site = "https://help.example.com";
  const widget = await page.request.post("/api/v1/widgets", {
    headers,
    data: { name: "Help", allowed_origins: [site], anonymous_enabled: true },
  });
  expect(widget.status(), await widget.text()).toBe(201);
  const { public_id } = (await widget.json()) as { public_id: string };

  // The widget's own calls, as its frame makes them: from the widget origin, no cookies.
  const frame = { origin: API };
  const session = await page.request.post(`${API}/v1/widget/sessions`, {
    headers: frame,
    data: { widget: public_id, parent_origin: site },
  });
  expect(session.status(), await session.text()).toBe(201);
  const bearer = { ...frame, authorization: `Bearer ${((await session.json()) as { session_token: string }).session_token}` };
  const chat = (await (await page.request.post(`${API}/v1/widget/conversations`, { headers: bearer, data: {} })).json()) as {
    id: string;
  };
  const ask = (content: string) =>
    page.request.post(`${API}/v1/widget/conversations/${chat.id}/messages`, { headers: bearer, data: { content } });
  expect((await ask("How do I export a note as a PDF?")).ok()).toBeTruthy();
  const read = (await (await page.request.get(`${API}/v1/widget/conversations/${chat.id}`, { headers: bearer })).json()) as {
    messages: { id: string; role: string; decision: { type: string } | null }[];
  };
  const answer = read.messages.findLast((m) => m.role === "agent");
  expect(answer?.decision?.type).toBe("answer");
  const note = "I needed the steps for a whole notebook.";
  const vote = await page.request.put(`${API}/v1/widget/conversations/${chat.id}/messages/${answer!.id}/feedback`, {
    headers: bearer,
    data: { vote: "down", comment: note },
  });
  expect(vote.status(), await vote.text()).toBe(200);
  expect((await ask("I would like to talk to a person.")).ok()).toBeTruthy();

  await page.goto("/app/inbox");
  const row = page.getByRole("region", { name: "Handoffs" }).getByRole("listitem");
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/app\/inbox\/[0-9a-f-]{36}$/);
  const transcript = page.getByRole("list", { name: "Conversation" });
  const card = transcript.getByText("Visitor said this did not help").locator("..").locator("..");
  await expect(card).toBeVisible();
  await expect(card).toContainText(note);
  await expect(card).toContainText("It counts in your wrong-answer rate.");
  // Owners can turn it into a test case right there.
  await card.getByRole("button", { name: "Add to eval set" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to eval set" });
  await expect(dialog.getByLabel("Question")).toHaveValue("How do I export a note as a PDF?");
  await expect(dialog).toContainText("thumbs down");
});
