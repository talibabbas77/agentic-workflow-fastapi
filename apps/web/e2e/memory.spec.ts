import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./signup";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
// Indexing a team answer runs the embedding model in the worker, and the preview's
// no-source path asks the model to sort the message, so give both time.
const PROCESSING = { timeout: 60_000 };

function answerRow(page: Page, question: string) {
  return page.getByRole("row").filter({ has: page.getByRole("button", { name: question, exact: true }) });
}

test("an owner adds, edits, and deletes a team answer", async ({ page }) => {
  await signUp(page, "Ada Lovelace", "Memory");
  await page.goto("/app/memory");
  await expect(page.getByRole("heading", { name: "No team answers yet" })).toBeVisible();

  await page.getByRole("button", { name: "Add answer" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a team answer" });
  await dialog.getByRole("button", { name: "Add answer" }).click();
  await expect(dialog).toContainText("Write the question as a customer would ask it.");
  await dialog.getByLabel("Question", { exact: true }).fill("Can I pay by bank transfer?");
  await dialog.getByLabel("Answer", { exact: true }).fill("Yes, on yearly plans. Ask the billing team for the details.");
  await dialog.getByRole("button", { name: "Add answer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Team answer added");

  const row = answerRow(page, "Can I pay by bank transfer?");
  await expect(row).toContainText("Everyone");
  await expect(row).toContainText("Ready", PROCESSING);
  await expect(page.getByRole("tab", { name: /Team answers/ })).toContainText("1");

  // Edit: new wording and only for signed-in customers.
  await row.getByRole("button", { name: "Can I pay by bank transfer?", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit team answer" });
  await expect(edit.getByLabel("Question", { exact: true })).toHaveValue("Can I pay by bank transfer?");
  await edit.getByLabel("Answer", { exact: true }).fill("Yes, on yearly plans only.");
  await edit.getByLabel("Who can get answers from it").selectOption("identified");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Team answer saved");
  await expect(row).toContainText("Yes, on yearly plans only.");
  await expect(row).toContainText("Signed-in customers");

  // Saved on the server, not only on the page.
  await page.reload();
  await expect(answerRow(page, "Can I pay by bank transfer?")).toContainText("Yes, on yearly plans only.");

  // Delete with confirmation.
  await page.getByRole("button", { name: "Actions for Can I pay by bank transfer?" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this team answer?" });
  await expect(confirm).toContainText("Can I pay by bank transfer?");
  await confirm.getByRole("button", { name: "Delete answer" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("heading", { name: "No team answers yet" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No team answers yet" })).toBeVisible();
});

test("a question the agent cannot answer becomes a gap, and answering it closes the gap", async ({ page }) => {
  const question = "How do I export my invoices to a CSV file?";
  await signUp(page, "Grace Hopper", "Gaps");

  // A new workspace has no sources, so the question takes the no-source path and hands off.
  await page.goto("/app/agent");
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(question);
  await message.press("Enter");
  await expect(page.getByRole("region", { name: "Handoff to your team" })).toContainText(
    "No supporting source",
    PROCESSING,
  );

  await page.goto("/app/memory");
  await page.getByRole("tab", { name: /Knowledge gaps/ }).click();
  const gaps = page.getByRole("region", { name: "Knowledge gaps" });
  await expect(gaps).toContainText(question);
  await expect(gaps).toContainText("Asked 1 time");

  await gaps.getByRole("button", { name: "Answer this" }).click();
  const dialog = page.getByRole("dialog", { name: "Answer this question" });
  await expect(dialog.getByLabel("Question", { exact: true })).toHaveValue(question);
  await dialog.getByLabel("Answer", { exact: true }).fill("Open Billing, then Invoices, and choose Download CSV.");
  await dialog.getByRole("button", { name: "Save and close question" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("1 question closed");
  await expect(page.getByRole("heading", { name: "No knowledge gaps" })).toBeVisible();

  // The gap stays closed, and the answer is in the team's list.
  await page.reload();
  await page.getByRole("tab", { name: /Knowledge gaps/ }).click();
  await expect(page.getByRole("heading", { name: "No knowledge gaps" })).toBeVisible();
  await page.getByRole("tab", { name: /Team answers/ }).click();
  await expect(answerRow(page, question)).toBeVisible();
});

test("the memory map shows details on keyboard focus and opens a branch's list", async ({ page }) => {
  await signUp(page, "Katherine Johnson", "Map");
  const created = await page.request.post("/api/v1/memory/answers", {
    headers: { origin: BASE },
    data: { question: "Do you have a mobile app?", answer: "Yes, for iOS and Android.", audience: "public" },
  });
  expect(created.status(), await created.text()).toBe(201);

  await page.goto("/app/memory");
  const map = page.getByRole("group", { name: /^Memory map/ });
  await expect(map).toBeVisible();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveCount(0);

  // The map is one tab stop after the top bar; its first node describes itself on focus.
  await page.getByRole("button", { name: /^Account menu/ }).focus();
  await page.keyboard.press("Tab");
  const knowledge = map.getByRole("button", { name: "Knowledge: 0 sources" });
  await expect(knowledge).toBeFocused();
  await expect(tooltip).toContainText("0 passages");
  await expect(tooltip).toContainText("Select to see the most cited sections.");
  await expect(knowledge).toHaveAttribute("aria-describedby", (await tooltip.getAttribute("id"))!);

  // Arrow keys move along the map: the team answers branch, then its one answer.
  await page.keyboard.press("ArrowRight");
  await expect(map.getByRole("button", { name: "Team answers: 1" })).toBeFocused();
  await expect(tooltip).toContainText("Written by your team");
  await page.keyboard.press("ArrowRight");
  await expect(map.getByRole("button", { name: "Do you have a mobile app?" })).toBeFocused();
  await expect(tooltip).toContainText("Not cited in the last 30 days");

  // Enter opens that branch's list below the map.
  await page.keyboard.press("Enter");
  const tab = page.getByRole("tab", { name: /Team answers/ });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(answerRow(page, "Do you have a mobile app?")).toBeVisible();
});
