import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const pages = ["/", "/how-it-works", "/pricing", "/security", "/docs", "/privacy", "/terms", "/contact"];

// En dash and em dash, built from code points so this file does not contain them.
const DASHES = String.fromCharCode(0x2013, 0x2014);

// Diagrams and the hero demo hold still under reduced motion, so contrast is measured on the final colors.
test.use({ reducedMotion: "reduce" });

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const path of pages) {
      test(`${path} has no serious accessibility issues`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("h1")).toBeVisible();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
          .toBe(colorScheme === "dark");
        expect(await seriousViolations(page), "serious or critical axe violations").toEqual([]);
      });
    }
  });
}

for (const path of pages) {
  test(`${path} has no dashes in its text`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();

    // Every text node, hidden tab panels and demo scenarios included, plus the title and description.
    const dashes = await page.evaluate((chars) => {
      const pattern = new RegExp(`[${chars}]`);
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest("script, style")) continue;
        if (pattern.test(node.textContent ?? "")) found.push(node.textContent ?? "");
      }
      const description = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
      return [...found, document.title, description].filter((text) => pattern.test(text));
    }, DASHES);
    expect(dashes).toEqual([]);
  });
}

test("pricing shows every plan from the API", async ({ page, request }) => {
  const response = await request.get("/api/v1/public/plans");
  expect(response.ok()).toBeTruthy();
  const plans = (await response.json()) as { name: string }[];
  expect(plans).toHaveLength(4);

  await page.goto("/pricing");
  for (const plan of plans) {
    await expect(page.getByRole("heading", { name: plan.name, exact: true })).toBeVisible();
  }
});

test("hero demo changes the conversation with the mouse and the keyboard", async ({ page }) => {
  await page.goto("/");
  const demo = page.getByTestId("hero-demo");
  const anonymous = demo.getByRole("radio", { name: /Anonymous visitor/ });
  const ana = demo.getByRole("radio", { name: /Signed in as Ana/ });
  const person = demo.getByRole("radio", { name: /Asks for a person/ });
  const shown = demo.locator("[data-active]");

  await expect(anonymous).toBeChecked();
  await expect(shown).toContainText("On Personal, ask from Settings, then Account");
  await expect(demo.getByText("From your account")).toBeHidden();
  await expect(demo.getByRole("figure").getByText("Public docs only", { exact: true })).toBeVisible();

  // Arrow keys move through the scenarios, like any radio group.
  await anonymous.focus();
  await page.keyboard.press("ArrowRight");
  await expect(ana).toBeChecked();
  await expect(shown).toContainText("You are on the Team plan");
  await expect(demo.getByText("From your account")).toBeVisible();
  await expect(demo.getByText('{ plan: "Team" }')).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(person).toBeChecked();
  await expect(shown).toContainText("Handed to the Lumen Notes team");
  await expect(shown).toContainText("Asked for a person");

  // And a click on the visible label.
  await demo.getByText("Anonymous visitor").click();
  await expect(anonymous).toBeChecked();
  await expect(shown).toContainText("On Personal, ask from Settings, then Account");
});

test("workflow explorer tabs work with the arrow keys", async ({ page }) => {
  await page.goto("/");
  const tablist = page.getByRole("tablist", { name: "How Docent works" });
  const teach = tablist.getByRole("tab", { name: /Teach/ });
  const answer = tablist.getByRole("tab", { name: /Answer/ });
  const handoff = tablist.getByRole("tab", { name: /Hand off/ });

  await expect(teach).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Teach the agent", exact: true })).toBeVisible();

  await teach.focus();
  await page.keyboard.press("ArrowRight");
  await expect(answer).toBeFocused();
  await expect(answer).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Answer with sources", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Teach the agent", exact: true })).toBeHidden();

  await page.keyboard.press("End");
  await expect(handoff).toBeFocused();
  await expect(page.getByRole("heading", { name: "Hand off to your team", exact: true })).toBeVisible();

  // The last tab wraps around to the first.
  await page.keyboard.press("ArrowRight");
  await expect(teach).toBeFocused();
  await expect(teach).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowLeft");
  await expect(handoff).toHaveAttribute("aria-selected", "true");
});

test("reply estimator recommends the smallest plan that fits", async ({ page, request }) => {
  const plans = (await (await request.get("/api/v1/public/plans")).json()) as {
    id: string;
    name: string;
    replies_per_month: number;
    trial_days?: number | null;
  }[];
  const monthly = plans.filter((p) => !p.trial_days).sort((a, b) => a.replies_per_month - b.replies_per_month);
  const top = monthly.at(-1)!;

  await page.goto("/pricing");
  const input = page.getByRole("spinbutton", { name: "How many AI replies do you expect each month?" });
  const result = page.getByTestId("estimate-result");

  for (const [replies, label] of [
    [500, "500"],
    [3000, "3,000"],
    [25000, "25,000"],
  ] as const) {
    await input.fill(String(replies));
    const fit = monthly.find((p) => p.replies_per_month >= replies);
    if (fit) {
      await expect(result).toContainText(`${fit.name} covers ${label} replies a month`);
      await expect(page.locator("[data-plan-card][data-fit]")).toHaveAttribute("data-plan-card", fit.id);
    } else {
      await expect(result).toContainText(`${label} replies a month is more than ${top.name} includes`);
      await expect(result).toContainText("Write to us");
      await expect(page.locator("[data-plan-card][data-fit]")).toHaveCount(0);
    }
  }

  // The expected plans for these three estimates, with today's catalog.
  expect(monthly.find((p) => p.replies_per_month >= 500)?.id).toBe("starter");
  expect(monthly.find((p) => p.replies_per_month >= 3000)?.id).toBe("growth");
  expect(monthly.find((p) => p.replies_per_month >= 25000)).toBeUndefined();
});

test("theme switch changes the html class, in the header and the small-screen menu", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("summary[aria-label=Menu]").click();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
});
