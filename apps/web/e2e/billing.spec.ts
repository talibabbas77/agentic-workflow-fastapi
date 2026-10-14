import { expect, test } from "@playwright/test";
import { signUp } from "./signup";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/*
 * The local stack runs without Stripe keys, so checkout is refused with a 503 and
 * the page says payments are not set up instead of offering a button that fails.
 */
test("billing shows the trial and this month's usage, and checkout waits for payments", async ({ page }) => {
  await signUp(page, "Ada Lovelace", "Billing");

  const refused = await page.request.post("/api/v1/billing/checkout", {
    headers: { origin: BASE },
    data: { plan_id: "starter" },
  });
  expect(refused.status()).toBe(503);
  expect((await refused.json()).error.code).toBe("billing_not_configured");

  // The old Usage page now lives here.
  await page.goto("/app/usage");
  await expect(page).toHaveURL(/\/app\/billing$/);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Billing" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const plan = page.getByRole("region", { name: "Current plan" });
  await expect(plan).toContainText("Trial");
  await expect(plan).toContainText("Free for 14 days");
  await expect(plan.getByTestId("plan-status")).toHaveText(/^Trial, 1[34] days left$/);
  await expect(plan.getByRole("button", { name: "Manage billing" })).toHaveCount(0);

  const usage = page.getByRole("region", { name: "Usage this month" });
  const replies = usage.getByRole("progressbar", { name: "AI replies used" });
  await expect(replies).toHaveAttribute("aria-valuetext", "0 of 100");
  await expect(usage.getByRole("progressbar", { name: "Pages of docs used" })).toHaveAttribute(
    "aria-valuetext",
    "0 of 200",
  );
  await expect(usage.getByRole("progressbar", { name: "Widgets used" })).toHaveAttribute("aria-valuetext", "0 of 1");
  await expect(usage.getByRole("progressbar", { name: "Seats used" })).toHaveAttribute("aria-valuetext", "1 of 2");
  await expect(page.getByText("Escalate-only mode")).toHaveCount(0);

  const plans = page.getByRole("region", { name: "Plans" });
  await expect(plans).toContainText("Payments are not set up on this server yet.");
  for (const name of ["Starter", "Growth", "Scale"]) {
    await expect(plans.getByRole("button", { name: `Choose plan ${name}` })).toBeDisabled();
  }
  await expect(plans.getByText("Current plan")).toHaveCount(0);

  // Coming back from a canceled checkout says so once, then the address is clean.
  await page.goto("/app/billing?checkout=canceled");
  await expect(page.getByRole("status").filter({ hasText: "Checkout canceled" })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/billing$/);
});

/*
 * A plan change on a subscribed workspace is covered by the API tests, which
 * fake Stripe. Here a trial workspace checks the wiring: the preview explains
 * the figures and says why the change cannot happen yet.
 */
test("plan changes are explained before they are made, and need a paid plan first", async ({ page }) => {
  await signUp(page, "Grace Hopper", "Plan changes");

  const preview = await page.request.get("/api/v1/billing/preview?plan_id=growth");
  expect(preview.status()).toBe(200);
  const body = await preview.json();
  expect(body.kind).toBe("upgrade");
  expect(body.blockers).toEqual(["Plan changes need a paid subscription. Choose a plan to start one."]);
  const total = body.lines.reduce((sum: number, line: { amount_cents: number }) => sum + line.amount_cents, 0);
  expect(total).toBe(body.due_now_cents);
  expect(body.explanation.length).toBeGreaterThan(0);

  const refund = await (await page.request.get("/api/v1/billing/refund")).json();
  expect(refund).toMatchObject({ eligible: false, amount_cents: 0, reason: "There is no payment to refund yet." });

  for (const path of ["/api/v1/billing/change", "/api/v1/billing/cancel", "/api/v1/billing/refund"]) {
    const refused = await page.request.post(path, { headers: { origin: BASE }, data: { plan_id: "growth" } });
    expect(refused.status(), path).toBe(503);
  }

  // A trial has nothing to cancel or refund, so the card offers neither.
  await page.goto("/app/billing");
  const plan = page.getByRole("region", { name: "Current plan" });
  await expect(plan.getByTestId("plan-status")).toHaveText(/^Trial/);
  await expect(plan.getByRole("button", { name: "Cancel plan" })).toHaveCount(0);
  await expect(plan.getByRole("button", { name: "Request a refund" })).toHaveCount(0);
});
