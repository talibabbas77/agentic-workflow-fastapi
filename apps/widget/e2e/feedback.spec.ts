/// <reference types="node" />
// "Was this helpful?" under answers, in Chromium and WebKit. The first test
// needs no chat model: the answer to the one question it asks is served by the
// test, and the vote requests are answered by the test too (the API side is
// covered by the API suite). Asking for a person goes to the real API, which
// hands off at once. The second test runs the whole thing against the real
// agent and needs a chat model (E2E_CHAT_MODEL=1).
import { randomUUID } from "node:crypto";
import { expect, test, type Frame, type Page, type Route } from "@playwright/test";
import { fakeClientIp, hosts, openWidget, recordWidgetCalls, send, shape, widgetFrame } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": fakeClientIp() } });

const QUESTION = "How do I export a note as a PDF?";

async function openLumen(page: Page): Promise<Frame> {
  await page.goto(`${hosts().host}/lumen-notes`);
  await openWidget(page);
  return widgetFrame(page);
}

const thumbs = (frame: Frame) => {
  const group = frame.getByRole("group", { name: "Was this helpful?" });
  return {
    group,
    up: group.getByRole("button", { name: "Helpful", exact: true }),
    down: group.getByRole("button", { name: "Not helpful" }),
  };
};

test("thumbs under an answer: up, down with a note, and a way to a person", async ({ page }) => {
  const calls = recordWidgetCalls(page.context());
  const answerId = randomUUID();
  // The answer to QUESTION comes from here, so no chat model is needed.
  await page.context().route("**/v1/widget/conversations/*/messages", async (route: Route) => {
    const body = route.request().postDataJSON() as { content?: string } | null;
    if (route.request().method() !== "POST" || body?.content !== QUESTION) return route.continue();
    const answer = {
      id: answerId,
      role: "agent",
      content: "Open the note and select **Export**, then choose PDF [1].",
      decision: { type: "answer", confidence: "high", reason: null, citations: [1], account_facts: [] },
      citations: [
        {
          marker: 1,
          document_title: "Exporting notes",
          heading_path: "Exporting notes",
          url: null,
          excerpt: "Open a note or notebook and select Export. Choose PDF, Markdown, or HTML.",
        },
      ],
      created_at: new Date().toISOString(),
      feedback: null,
    };
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `event: message\ndata: ${JSON.stringify(answer)}\n\n`,
    });
  });
  await page.context().route(`**/messages/${answerId}/feedback`, async (route: Route) => {
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204 });
    const body = route.request().postDataJSON() as { vote: string; comment?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ vote: body.vote, comment: body.comment ?? "", updated_at: new Date().toISOString() }),
    });
  });

  const frame = await openLumen(page);
  await send(frame, QUESTION);
  const answer = frame.locator(`li.msg.agent[data-id="${answerId}"]`);
  await expect(answer).toContainText("choose PDF");
  const { group, up, down } = thumbs(frame);
  await expect(up).toHaveAttribute("aria-pressed", "false");
  await expect(down).toHaveAttribute("aria-pressed", "false");
  // The greeting is not an answer: one group only.
  await expect(frame.getByRole("group", { name: "Was this helpful?" })).toHaveCount(1);

  // From the keyboard: a thumbs up says thanks.
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await expect(group).toContainText("Thanks for letting us know.");

  // A thumbs down asks what was wrong, in a labelled field that takes focus.
  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "true");
  await expect(up).toHaveAttribute("aria-pressed", "false");
  const note = frame.getByRole("textbox", { name: "What was wrong? (optional)" });
  await expect(note).toBeFocused();
  await expect(note).toHaveAttribute("maxlength", "500");
  await note.fill("It should say how to export a whole notebook.");
  await frame.getByRole("button", { name: "Send", exact: true }).first().click();
  await expect(group).toContainText("Thanks. The team will read your note.");
  await expect(note).toBeHidden();

  const votes = () =>
    calls.filter((c) => c.path.endsWith("/feedback")).map((c) => [c.method, c.body] as [string, unknown]);
  expect(votes()).toEqual([
    ["PUT", { vote: "up" }],
    ["PUT", { vote: "down" }],
    ["PUT", { vote: "down", comment: "It should say how to export a whole notebook." }],
  ]);

  // Pressing it again takes the vote back; down once more offers a person.
  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "false");
  await down.click();
  const person = group.getByRole("button", { name: "Talk to a person" });
  await expect(person).toBeVisible();
  await person.click();
  await expect(frame.locator(".msg.visitor").last()).toHaveText(/I would like to talk to a person\./);
  // The real API hands off, the normal way: the visitor is asked where to reply.
  await expect(frame.locator(".msg.agent .note")).toContainText("A person from the team will follow up.");
  await expect(person).toBeHidden();
  expect(shape(calls).filter((c) => c.endsWith("/messages"))).toEqual([
    "POST /v1/widget/conversations/:id/messages",
    "POST /v1/widget/conversations/:id/messages",
  ]);
});

test("a vote on a real answer is kept and comes back after a reload", async ({ page, browserName }) => {
  test.skip(process.env.E2E_CHAT_MODEL !== "1", "Needs a chat model. Set E2E_CHAT_MODEL=1 to run.");
  test.skip(browserName !== "chromium", "The model run once is enough.");
  test.setTimeout(120_000);
  const frame = await openLumen(page);
  await send(frame, QUESTION);
  const { group, down } = thumbs(frame);
  await expect(group).toBeVisible({ timeout: 90_000 });
  await down.click();
  const note = frame.getByRole("textbox", { name: "What was wrong? (optional)" });
  await note.fill("I wanted the steps for a whole notebook.");
  await frame.getByRole("button", { name: "Send", exact: true }).first().click();
  await expect(group).toContainText("Thanks. The team will read your note.");

  // Same tab, new page load: the conversation resumes with the vote pressed.
  await page.reload();
  await openWidget(page);
  const again = thumbs(await widgetFrame(page));
  await expect(again.down).toHaveAttribute("aria-pressed", "true");
  await expect(again.up).toHaveAttribute("aria-pressed", "false");
});
