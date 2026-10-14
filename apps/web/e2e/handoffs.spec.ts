import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./signup";

function typeRow(page: Page, name: string) {
  return page.getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) });
}

test("an owner adds, edits, and deletes a ticket type", async ({ page }) => {
  await signUp(page, "Ada Lovelace", "Handoffs");
  await page.goto("/app/handoffs");
  await expect(page.getByRole("heading", { name: "No ticket types yet" })).toBeVisible();

  // Add one with two details, reordered, and someone to email.
  await page.getByRole("button", { name: "Add ticket type" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a ticket type" });
  await dialog.getByLabel("Name").fill("Refund request");
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByLabel("What belongs here").fill("Customers asking for money back on an order.");

  await dialog.getByRole("button", { name: "Add detail" }).click();
  await dialog.getByLabel("Label").nth(0).fill("Order number");
  await expect(dialog.getByLabel("Key").nth(0)).toHaveValue("order_number");
  await dialog.getByRole("button", { name: "Add detail" }).click();
  await dialog.getByLabel("Label").nth(1).fill("Refund to");
  await dialog.getByLabel("Type").nth(1).selectOption("select");
  const choices = dialog.getByLabel("Choices");
  await choices.fill("Card");
  await choices.press("Enter");
  await choices.fill("Store credit");
  await choices.press("Enter");
  await dialog.getByRole("checkbox", { name: "Required" }).nth(1).check();
  await dialog.getByRole("button", { name: "Move Refund to up" }).click();
  await expect(dialog.getByLabel("Label").nth(0)).toHaveValue("Refund to");

  const emails = dialog.getByLabel("Who to email");
  await emails.fill("not-an-email");
  await emails.press("Enter");
  await expect(dialog).toContainText("not-an-email is not an email address.");
  await emails.fill("billing@example.com");
  await emails.press("Enter");
  await expect(dialog.getByRole("button", { name: "Remove billing@example.com" })).toBeVisible();

  await dialog.getByRole("button", { name: "Add ticket type" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Ticket type added");
  const row = typeRow(page, "Refund request");
  await expect(row).toContainText("2 details");
  await expect(row).toContainText("1 person");
  await expect(row).toContainText("High");
  await expect(row).toContainText("Active");

  // Names are unique within a workspace.
  await page.getByRole("button", { name: "Add ticket type" }).click();
  const duplicate = page.getByRole("dialog", { name: "Add a ticket type" });
  await duplicate.getByLabel("Name").fill("Refund request");
  await duplicate.getByLabel("What belongs here").fill("Same name on purpose.");
  await duplicate.getByRole("button", { name: "Add ticket type" }).click();
  await expect(duplicate).toContainText("A ticket type with this name exists.");
  await duplicate.getByRole("button", { name: "Cancel" }).click();
  await expect(duplicate).toBeHidden();

  // Edit: rename, drop a detail, and turn it off.
  await row.getByRole("button", { name: "Refund request", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit Refund request" });
  await expect(edit.getByLabel("Label").nth(0)).toHaveValue("Refund to");
  await edit.getByLabel("Name").fill("Refund");
  await edit.getByRole("button", { name: "Remove Order number" }).click();
  await edit.getByRole("switch", { name: "Active" }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Ticket type saved");
  const renamed = typeRow(page, "Refund");
  await expect(renamed).toContainText("1 detail");
  await expect(renamed).toContainText("Off");

  // Saved on the server.
  await page.reload();
  await expect(typeRow(page, "Refund")).toContainText("Off");

  // Delete with confirmation.
  await page.getByRole("button", { name: "Actions for Refund" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Refund?" });
  await confirm.getByRole("button", { name: "Delete ticket type" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("heading", { name: "No ticket types yet" })).toBeVisible();
});
