import { expect, test } from "@playwright/test";
import { uniqueEmail, waitForLink } from "./mailpit";

const PASSWORD = "correct horse battery";

test("logged out visitors are sent to log in", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsettings$/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("an owner signs up, confirms email, and a teammate joins", async ({ page, browser }) => {
  const ownerEmail = uniqueEmail("owner");
  const teammateEmail = uniqueEmail("teammate");
  const workspace = `Northwind ${Date.now().toString(36)}`;

  // Sign up and land on the overview.
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Work email").fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Workspace name").fill(workspace);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible();
  const banner = page.getByTestId("verify-banner");
  await expect(banner).toBeVisible();
  await expect(page.getByText("1 of 6 done")).toBeVisible();

  // Confirm the email from the link Docent sent.
  const verifyLink = await waitForLink(ownerEmail, "/verify-email?token=");
  await page.goto(verifyLink);
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "Continue to Docent" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(page.getByText("2 of 6 done")).toBeVisible();

  // Log out, then back in.
  await page.getByRole("button", { name: "Account menu for Ada Lovelace" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Invite a teammate from the onboarding journey.
  await page.getByRole("link", { name: /Invite your team/ }).click();
  await expect(page).toHaveURL(/\/app\/settings\/members/);
  const dialog = page.getByRole("dialog", { name: "Invite a teammate" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Work email").fill(teammateEmail);
  await dialog.getByLabel("Role").selectOption("agent");
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Invitation sent")).toBeVisible();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText(teammateEmail);
  await expect(page.getByRole("listitem").filter({ hasText: teammateEmail })).toBeVisible();

  // The teammate opens the link in a fresh browser and creates an account.
  const inviteLink = await waitForLink(teammateEmail, "/invite?token=");
  const teammate = await browser.newContext();
  const other = await teammate.newPage();
  await other.goto(inviteLink);
  await expect(other.getByRole("heading", { name: `Join ${workspace} as an agent` })).toBeVisible();
  await other.getByLabel("Your name").fill("Grace Hopper");
  await other.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await other.getByRole("button", { name: "Create account and join" }).click();

  await expect(other).toHaveURL(/\/app$/);
  await expect(other.getByRole("heading", { name: "Welcome, Grace" })).toBeVisible();
  await expect(other.getByRole("button", { name: /Switch workspace/ })).toContainText(workspace);

  // Agents cannot manage members.
  await other.goto("/app/settings/members");
  await expect(other.getByRole("heading", { name: "Only owners and admins can manage members" })).toBeVisible();
  await teammate.close();

  // The owner now sees the teammate as a member.
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: "Grace Hopper" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("combobox", { name: "Role for Grace Hopper" })).toHaveValue("agent");
});
