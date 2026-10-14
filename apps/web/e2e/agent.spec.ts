import { expect, test } from "@playwright/test";
import { signUp } from "./signup";

/*
 * Both handoffs here are decided before any model call: a restricted topic is
 * caught by a rule, and a workspace with no sources fails the evidence gate. So
 * these tests are fast and do not depend on the local model.
 */
const HANDOFF = { timeout: 30_000 };

test("an owner saves agent settings and a restricted topic hands off in the preview", async ({ page }) => {
  await signUp(page, "Ada Lovelace", "Agent");
  await page.goto("/app/agent");

  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByLabel("Name", { exact: true }).fill("Ada's helper");
  await settings.getByText("Formal", { exact: true }).click();
  const topics = settings.getByLabel("Restricted topics");
  await topics.fill("invoice dispute");
  await topics.press("Enter");
  await expect(settings.getByRole("button", { name: "Remove invoice dispute" })).toBeVisible();
  await settings.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Agent settings saved");
  await expect(settings.getByRole("button", { name: "Save changes" })).toBeDisabled();

  // Saved on the server, not only on the page.
  await page.reload();
  await expect(settings.getByLabel("Name", { exact: true })).toHaveValue("Ada's helper");
  await expect(settings.getByRole("radio", { name: "Formal" })).toBeChecked();
  await expect(settings.getByRole("button", { name: "Remove invoice dispute" })).toBeVisible();

  // The topic makes the agent hand the conversation to the team.
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("I want to raise an invoice dispute about last month");
  await message.press("Enter");
  const conversation = page.getByRole("log", { name: "Conversation" });
  await expect(conversation).toContainText("I want to raise an invoice dispute about last month");
  const handoff = conversation.getByRole("region", { name: "Handoff to your team" });
  await expect(handoff).toContainText("Restricted topic", HANDOFF);
  await expect(message).toBeEnabled();
});

test("a question with no supporting source hands off without asking the model", async ({ page }) => {
  await signUp(page, "Grace Hopper", "Preview");
  await page.goto("/app");
  await page.getByRole("link", { name: /First answer/ }).click();
  await expect(page).toHaveURL(/\/app\/agent$/);
  await expect(page.getByText("Ask something your customers ask")).toBeVisible();

  // Signed-in mode stands in for the token's claims, starting with a plan. With claims the agent
  // may answer from them alone, which takes the model, so this question is asked anonymously.
  await page.getByText("Signed-in customer", { exact: true }).click();
  await expect(page.getByLabel("Claim 1 name")).toHaveValue("plan");
  await expect(page.getByLabel("Claim 1 value")).toHaveValue("Pro");
  await page.getByText("Anonymous visitor", { exact: true }).click();
  await expect(page.getByLabel("Claim 1 name")).toHaveCount(0);

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("How do I export my notes to a spreadsheet?");
  await page.getByRole("button", { name: "Send" }).click();

  // A new workspace has no sources, so the evidence gate hands off without asking the model.
  const handoff = page.getByRole("region", { name: "Handoff to your team" });
  await expect(handoff).toContainText("No supporting source", HANDOFF);
  await expect(handoff).toContainText("Handed to your team");
  await expect(page.getByRole("radio", { name: "Signed-in customer" })).toBeDisabled();

  // A new conversation clears the chat and unlocks who is asking.
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByText("Ask something your customers ask")).toBeVisible();
  await expect(handoff).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Anonymous visitor" })).toBeEnabled();

  // A cited answer, streamed by a stand-in for the API so no model is needed: markers become
  // chips that open the source list, and the text is rendered without any HTML.
  await page.route("**/api/v1/agent/conversations/*/messages", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: CITED_STREAM }),
  );
  await message.fill("Can I get a refund on a yearly plan?");
  await message.press("Enter");
  const conversation = page.getByRole("log", { name: "Conversation" });
  await conversation.getByRole("button", { name: "Source 1: Billing and refunds" }).click();
  const sources = conversation.getByRole("list", { name: "Sources" });
  await expect(sources).toBeVisible();
  await expect(conversation.getByRole("button", { name: "2 sources" })).toHaveAttribute("aria-expanded", "true");
  await expect(sources.getByRole("listitem").first()).toContainText("Yearly plans are refunded in full");
  await expect(sources.getByRole("link", { name: /help\.example\.com\/refunds/ })).toBeVisible();
  await expect(conversation.locator("strong", { hasText: "Settings" })).toBeVisible();
  await expect(conversation.locator("img")).toHaveCount(0);
  await expect(conversation).toContainText("<img src=x>");
});

test("a greeting gets a plain reply, and an anonymous handoff asks where the team should reply", async ({
  page,
}) => {
  await signUp(page, "Katherine Johnson", "Contact");
  await page.goto("/app/agent");
  const conversation = page.getByRole("log", { name: "Conversation" });
  const message = page.getByRole("textbox", { name: "Message" });

  // Small talk is answered by a rule: a plain bubble, with no sources and no confidence.
  await message.fill("Hello!");
  await message.press("Enter");
  const greeting = conversation.getByRole("listitem").filter({ hasText: "Hi! I'm" });
  await expect(greeting).toBeVisible(HANDOFF);
  await expect(greeting.getByRole("button", { name: /source/ })).toHaveCount(0);
  await expect(greeting).not.toContainText("confidence");
  await expect(conversation.getByRole("region", { name: "Handoff to your team" })).toHaveCount(0);

  // Asking for a person hands off at once. The anonymous visitor is asked for an email.
  await message.fill("I want to talk to a person");
  await message.press("Enter");
  const handoff = conversation.getByRole("region", { name: "Handoff to your team" });
  await expect(handoff).toContainText("Asked for a person", HANDOFF);
  await expect(handoff).toContainText("Waiting for an email");
  await expect(conversation).toContainText("Leave your email below so they can reply.");

  const email = page.getByLabel("Where should the team reply?");
  await email.fill("not-an-email");
  await page.getByRole("form").getByRole("button", { name: "Send" }).click();
  await expect(conversation).toContainText("Enter an email address like name@example.com.");
  await email.fill("ada@example.com");
  await email.press("Enter");

  // The email goes to the agent as the visitor's next message, and the agent confirms it.
  await expect(conversation).toContainText("Thanks. The team will reply to ada@example.com.", HANDOFF);
  await expect(email).toHaveCount(0);
  await expect(handoff).toContainText("Reply to");
  await expect(handoff).toContainText("ada@example.com");
  await expect(handoff).not.toContainText("Waiting for an email");
});

const CITED_REPLY = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "agent",
  content: "Yes, within 30 days of paying [1]. Ask from **Settings**, then Billing [2]. <img src=x>",
  decision: { type: "answer", confidence: "high", reason: null, citations: [1, 2], account_facts: [] },
  citations: [
    {
      marker: 1,
      document_title: "Billing and refunds",
      heading_path: "Billing and refunds > Refunds",
      url: "https://help.example.com/refunds",
      excerpt: "Yearly plans are refunded in full within 30 days of payment.",
    },
    {
      marker: 2,
      document_title: "Account settings",
      heading_path: "Account settings > Billing",
      url: null,
      excerpt: "Open Settings, then Billing, to change or cancel your plan.",
    },
  ],
  created_at: null,
};

// Mixed line endings on purpose: the stream reader accepts \n and \r\n alike.
const CITED_STREAM = [
  'event: status\r\ndata: {"stage": "searching"}\r\n\r\n',
  'event: status\ndata: {"stage": "writing"}\n\n',
  `event: message\ndata: ${JSON.stringify(CITED_REPLY)}\n\n`,
].join("");
