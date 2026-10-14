import { expect, test } from "@playwright/test";
import { signUp } from "./signup";

/**
 * Evals end to end: create a set and a case in the browser, start a run, and
 * read its results. The case asks for a person, so the agent's rules hand it
 * off without a model call, and the worker finishes the run in seconds.
 */
test("an owner creates a set and a case, runs it, and sees the results", async ({ page }) => {
  await signUp(page, "Mary Jackson", "Evals");

  await page.goto("/app/evals");
  await expect(page.getByRole("heading", { name: "No test sets yet" })).toBeVisible();
  await page.getByRole("button", { name: "New set" }).click();
  const create = page.getByRole("dialog", { name: "New eval set" });
  await create.getByLabel("Name").fill("Handoffs");
  await create.getByLabel("Description").fill("Requests only the team can handle.");
  await create.getByRole("button", { name: "Create set" }).click();
  await expect(page).toHaveURL(/\/app\/evals\/sets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Handoffs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run eval" })).toBeDisabled(); // no cases yet

  await page.getByRole("button", { name: "Add case" }).click();
  const editor = page.getByRole("dialog", { name: "Add a case" });
  await editor.getByLabel("Question").fill("Please let me talk to a person about my invoice");
  await editor.getByText("Hand off", { exact: true }).click();
  await editor.getByText("Signed-in customer", { exact: true }).click();
  await editor.getByLabel("Claim 1 value").fill("Team");
  await editor.getByLabel("Must not include").fill("refund approved");
  await editor.getByLabel("Must not include").press("Enter");
  await editor.getByLabel("Tags").fill("handoff");
  await editor.getByLabel("Tags").press("Enter");
  await editor.getByRole("button", { name: "Add case" }).click();
  await expect(editor).toBeHidden();

  const cases = page.getByRole("list", { name: "Cases" });
  await expect(cases).toContainText("Please let me talk to a person about my invoice");
  await expect(cases).toContainText("Should hand off");
  await expect(cases).toContainText("plan=Team");

  await page.getByRole("button", { name: "Run eval" }).click();
  await expect(page).toHaveURL(/\/app\/evals\/runs\/[0-9a-f-]{36}$/);
  // The page follows the run until the worker finishes it.
  await expect(page.getByText("Finished", { exact: true })).toBeVisible({ timeout: 45_000 });
  const stats = page.getByLabel("Run results");
  await expect(stats).toContainText("Passed");
  await expect(stats).toContainText("100%");
  const results = page.getByRole("list", { name: "Case results" });
  await expect(results).toContainText("Handed off as expected");

  // Open the case: the reply, each check, and what it ran as.
  await results.getByText("Please let me talk to a person about my invoice").click();
  await expect(results).toContainText("Expected a handoff, got a handoff.");
  await expect(results).toContainText("Says none of the forbidden phrases.");
  await expect(results).toContainText("plan=Team");

  // The run is listed under Runs, and the set shows how it went.
  await page.getByRole("navigation", { name: "Evals" }).getByRole("link", { name: "Runs" }).click();
  await expect(page.getByRole("link", { name: "Handoffs" })).toBeVisible();
  await page.getByRole("navigation", { name: "Evals" }).getByRole("link", { name: "Sets" }).click();
  await expect(page.getByRole("list", { name: "Eval sets" })).toContainText("100% passed");

  // Metrics and review are honest about having no widget traffic yet.
  await page.getByRole("navigation", { name: "Evals" }).getByRole("link", { name: "Metrics" }).click();
  await expect(page.getByRole("heading", { name: "No customer conversations in the last 30 days" })).toBeVisible();
  await page.getByRole("navigation", { name: "Evals" }).getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Nothing to review this week" })).toBeVisible();
});
