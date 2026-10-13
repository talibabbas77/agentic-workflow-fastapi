import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const pages = ["/", "/how-it-works", "/pricing", "/security", "/docs", "/privacy", "/terms", "/contact"];

// En dash and em dash, built from code points so this file does not contain them.
const DASHES = String.fromCharCode(0x2013, 0x2014);

// Diagrams hold still under reduced motion, so contrast is measured on the final colors.
test.use({ reducedMotion: "reduce" });

for (const path of pages) {
  test(`${path} has no serious accessibility issues and no dashes in its text`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      serious.map((v) => ({ rule: v.id, targets: v.nodes.map((n) => n.target.join(" ")) })),
      "serious or critical axe violations",
    ).toEqual([]);

    // Every text node, hidden tab panels included, plus the title and description.
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
