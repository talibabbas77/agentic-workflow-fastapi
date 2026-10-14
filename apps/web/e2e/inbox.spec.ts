import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { uniqueEmail, waitForLink, waitForMessage } from "./mailpit";
import { signUp } from "./signup";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "correct horse battery";
const headers = { origin: BASE };

/** A conversation in the preview where the customer asks for a person: a handoff, no model call. */
async function handoff(api: APIRequestContext, topic: string, contact: string | null) {
  const conversation = await api.post("/api/v1/agent/conversations", { headers, data: {} });
  expect(conversation.status(), await conversation.text()).toBe(201);
  const { id } = (await conversation.json()) as { id: string };
  if (topic.startsWith("hello")) {
    await api.post(`/api/v1/agent/conversations/${id}/messages`, { headers, data: { content: "hello there" } });
  }
  const text = `Please let me talk to a person about ${topic}${contact ? `, my email is ${contact}` : ""}`;
  const sent = await api.post(`/api/v1/agent/conversations/${id}/messages`, { headers, data: { content: text } });
  expect(sent.ok()).toBeTruthy();
  const detail = (await (await api.get(`/api/v1/agent/conversations/${id}`)).json()) as { escalation: { id: string } };
  return detail.escalation.id;
}

async function verify(page: Page, email: string) {
  const link = await waitForLink(email, "/verify-email?token=");
  const token = new URL(link).searchParams.get("token")!;
  const verified = await page.request.post("/api/v1/auth/verify-email", { headers, data: { token } });
  expect(verified.status()).toBe(204);
}

function row(page: Page, text: string) {
  return page.getByRole("region", { name: "Handoffs" }).getByRole("listitem").filter({ hasText: text });
}

test("a new handoff shows up in the inbox, emails the team, and filters narrow the list", async ({ page }) => {
  const owner = await signUp(page, "Ada Lovelace", "Inbox");
  await verify(page, owner);
  const triage = uniqueEmail("triage");
  const rule = await page.request.post("/api/v1/automation/rules", {
    headers,
    data: { name: "Everyone hears", notify_emails: [triage] },
  });
  expect(rule.status(), await rule.text()).toBe(201);

  await page.goto("/app/inbox");
  await expect(page.getByRole("heading", { name: "No handoffs yet" })).toBeVisible();

  // The page is open when the handoff arrives: it shows up within a few seconds.
  const refundContact = uniqueEmail("refund");
  const exportContact = uniqueEmail("export");
  await handoff(page.request, "a refund for order 1042", refundContact);
  await expect(row(page, refundContact)).toBeVisible({ timeout: 6_000 });
  await handoff(page.request, "exporting my notes", exportContact);
  await expect(row(page, exportContact)).toBeVisible({ timeout: 6_000 });
  await expect(page.getByRole("main").getByText("2 unread")).toBeVisible();
  // The sidebar badge counts the same handoffs.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Inbox 2 unread" })).toBeVisible();
  await expect(row(page, refundContact)).toContainText("Unread");

  // The rule emails the team; the email links to the handoff.
  const notice = await waitForMessage(triage, "New handoff", 60_000);
  expect(notice.From.Name).toContain("via Docent");

  await page.getByLabel("Search").fill("refund");
  await expect(row(page, exportContact)).toBeHidden();
  await expect(row(page, refundContact)).toBeVisible();
  expect(page.url()).toContain("q=refund");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(row(page, exportContact)).toBeVisible();

  await page.getByRole("button", { name: /^Resolved/ }).click();
  await expect(page.getByRole("heading", { name: "Nothing matches these filters" })).toBeVisible();
  await page.getByRole("button", { name: /^Not resolved/ }).click();
  await page.getByLabel("Assignee").selectOption("unassigned");
  await expect(row(page, refundContact)).toBeVisible();
  await page.getByLabel("Assignee").selectOption("me");
  await expect(page.getByRole("heading", { name: "Nothing matches these filters" })).toBeVisible();
});

test("on the board, a handoff moves to another column with the keyboard", async ({ page }) => {
  await signUp(page, "Grace Hopper", "Board");
  const contact = uniqueEmail("board");
  await handoff(page.request, "a broken sync", contact);

  await page.goto("/app/inbox?view=board");
  const open = page.getByRole("region", { name: "Open" });
  const waiting = page.getByRole("region", { name: "Waiting on customer" });
  await expect(open.getByRole("listitem").filter({ hasText: contact })).toBeVisible();

  const move = open.getByRole("button", { name: /^Move to: / });
  await move.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("button", { name: "Waiting on customer" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab"); // into the menu: Open is the current column, so Assigned
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeFocused();
  await page.keyboard.press("Enter");

  const card = waiting.getByRole("listitem").filter({ hasText: contact });
  await expect(card).toBeVisible();
  await expect(open.getByRole("listitem").filter({ hasText: contact })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /^Move to: / })).toBeFocused();
  await expect(page.getByText(/^Moved to Waiting on customer/)).toBeAttached();

  await page.reload();
  // Until the summary lands, the card's title is the customer's message, which also has the email.
  await expect(
    page.getByRole("region", { name: "Waiting on customer" }).getByRole("listitem").filter({ hasText: contact }),
  ).toBeVisible();
});

test("a handoff gets a reply by email, a note, and an answer marked as wrong", async ({ page }) => {
  const owner = await signUp(page, "Katherine Johnson", "Replies");
  await verify(page, owner); // Docent emails customers only for members with a verified address
  const contact = uniqueEmail("customer");
  await handoff(page.request, "hello, my missing invoice", contact);

  await page.goto("/app/inbox");
  await row(page, contact).getByRole("link").click();
  await expect(page).toHaveURL(/\/app\/inbox\/[0-9a-f-]{36}$/);
  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(conversation).toContainText("hello there");

  // Mark the agent's greeting as wrong, with a reason.
  await conversation.getByRole("button", { name: "Mark as wrong" }).first().click();
  const flag = page.getByRole("dialog", { name: "Mark this answer as wrong" });
  await flag.getByLabel("What was wrong").fill("It should have asked which invoice.");
  await flag.getByRole("button", { name: "Mark as wrong" }).click();
  await expect(flag).toBeHidden();
  await expect(conversation).toContainText("Marked as a wrong answer");
  await expect(conversation).toContainText("It should have asked which invoice.");

  // Reply by email: it reaches the customer from the workspace, and their answer comes back to us.
  await page.getByLabel(/^Reply to/).fill("Hi, we found the invoice and sent it again.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Reply sent");
  await expect(conversation).toContainText("Hi, we found the invoice and sent it again.");
  await expect(conversation.getByText(/^Emailed to /)).toBeVisible({ timeout: 30_000 });
  const email = await waitForMessage(contact, "Your question to Replies");
  expect(email.From.Name).toMatch(/^Replies .* via Docent$/);
  expect(email.ReplyTo.map((r) => r.Address)).toEqual([owner]);
  expect(email.Text).toContain("Hi, we found the invoice and sent it again.");
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("waiting");

  // An internal note.
  await page.getByRole("textbox", { name: "Add a note" }).fill("Customer also asked about the April invoice.");
  await page.getByRole("button", { name: "Add note" }).click();
  const notes = page.getByRole("list", { name: "Notes" });
  await expect(notes).toContainText("Customer also asked about the April invoice.");

  // All of it is saved.
  await page.reload();
  await expect(page.getByRole("list", { name: "Notes" })).toContainText("April invoice");
  await expect(page.getByRole("list", { name: "Conversation" })).toContainText("Marked as a wrong answer");
  await expect(page.getByRole("region", { name: "Activity" })).toContainText("Replied by email to");
});

test("an agent works the inbox but sees no automation write controls", async ({ page, browser }) => {
  const owner = await signUp(page, "Margaret Hamilton", "Roles");
  await verify(page, owner);
  const agentEmail = uniqueEmail("agent");
  const invited = await page.request.post("/api/v1/invitations", { headers, data: { email: agentEmail, role: "agent" } });
  expect(invited.status(), await invited.text()).toBe(201);
  const rule = await page.request.post("/api/v1/automation/rules", {
    headers,
    data: { name: "Urgent for enterprise", set_priority: "urgent", claim_conditions: [{ key: "plan", op: "equals", value: "Enterprise" }] },
  });
  expect(rule.status()).toBe(201);
  const contact = uniqueEmail("customer");
  await handoff(page.request, "an invoice", contact);

  const link = await waitForLink(agentEmail, "/invite?token=");
  const token = new URL(link).searchParams.get("token")!;
  const agentContext = await browser.newContext({ baseURL: BASE });
  const agentPage = await agentContext.newPage();
  const accepted = await agentPage.request.post("/api/v1/invitations/accept", {
    headers,
    data: { token, name: "Dorothy Vaughan", password: PASSWORD },
  });
  expect(accepted.status(), await accepted.text()).toBe(200);

  await agentPage.goto("/app/automation");
  await expect(agentPage.getByRole("heading", { name: "Automation", level: 1 })).toBeVisible();
  await expect(agentPage.getByText("Owners and admins change automation.")).toBeVisible();
  await expect(agentPage.getByText("Urgent for enterprise")).toBeVisible();
  for (const name of ["Add rule", "Add Slack channel", "Add webhook", "Save"]) {
    await expect(agentPage.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(agentPage.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
  await expect(agentPage.getByRole("button", { name: /^Move .* (up|down)$/ })).toHaveCount(0);
  await expect(agentPage.getByLabel("Support email")).toHaveAttribute("readonly", "");
  // Their own notifications are theirs to change.
  await expect(agentPage.getByRole("switch", { name: "Daily digest" })).toBeEnabled();

  // And they work the inbox: open the handoff, take it, and leave a note.
  await agentPage.goto("/app/inbox");
  await row(agentPage, contact).getByRole("link").click();
  await agentPage.getByRole("button", { name: "Assign to me" }).click();
  await expect(agentPage.getByRole("combobox", { name: "Assigned to" })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(agentPage.getByRole("combobox", { name: "Status" })).toHaveValue("assigned");
  await agentPage.getByRole("textbox", { name: "Add a note" }).fill("I have this one.");
  await agentPage.getByRole("button", { name: "Add note" }).click();
  await expect(agentPage.getByRole("list", { name: "Notes" })).toContainText("I have this one.");
  await agentContext.close();
});
