import { expect, request, test, type Page } from "@playwright/test";
import { uniqueEmail, waitForLink } from "./mailpit";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "correct horse battery";
// Embedding runs on a real model in the worker, so give processing time.
const PROCESSING = { timeout: 60_000 };

const SHIPPING = `# Shipping times

## Canada

Orders to Canada arrive in 4 to 6 business days. Tracking starts when the parcel leaves our warehouse.

## Returns

Send items back within 30 days in their original packaging.
`;

async function signUp(page: Page, name: string) {
  const email = uniqueEmail(name.split(" ")[0]!.toLowerCase());
  const response = await page.request.post("/api/v1/auth/signup", {
    headers: { origin: BASE },
    data: { name, email, password: PASSWORD, workspace_name: `Knowledge ${Date.now().toString(36)}` },
  });
  expect(response.status(), await response.text()).toBe(201);
  return email;
}

function sourceRow(page: Page, title: string) {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

test("an owner uploads a document, searches it, re-syncs, and deletes it", async ({ page }) => {
  await signUp(page, "Ada Lovelace");
  await page.goto("/app/knowledge");
  await expect(page.getByRole("heading", { name: "How teaching works" })).toBeVisible();

  // Upload through the dialog.
  await page.getByRole("button", { name: "Add source" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a source" });
  await expect(dialog.getByRole("tab", { name: "Upload files" })).toHaveAttribute("aria-selected", "true");
  await dialog.getByLabel("Choose files to upload").setInputFiles({
    name: "shipping.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(SHIPPING),
  });
  await expect(dialog.getByText("shipping.md")).toBeVisible();
  await dialog.getByRole("button", { name: "Upload file" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Source added");

  const row = sourceRow(page, "shipping");
  await expect(row).toContainText("Ready", PROCESSING);

  // Test search finds it.
  await page.getByLabel("Question").fill("How long does delivery to Canada take?");
  await page.getByRole("button", { name: "Search" }).click();
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results).toContainText("Shipping times");
  await expect(results).toContainText("4 to 6 business days");

  // Re-sync, and it settles back to ready.
  await page.getByRole("button", { name: "Actions for shipping" }).click();
  await page.getByRole("button", { name: "Re-sync" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Re-sync started");
  await expect(row).toContainText("Ready", PROCESSING);

  // Delete with confirmation; the source goes away.
  await page.getByRole("button", { name: "Actions for shipping" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete shipping?" });
  await confirm.getByRole("button", { name: "Delete source" }).click();
  await expect(confirm).toBeHidden();
  await expect(row).toHaveCount(0, PROCESSING);
  await expect(page.getByRole("heading", { name: "How teaching works" })).toBeVisible();
});

test("an agent sees the sources but cannot add or change them", async ({ page, browser }) => {
  const ownerEmail = await signUp(page, "Grace Hopper");

  // The owner confirms their email, adds a source, and invites an agent.
  const verifyLink = await waitForLink(ownerEmail, "/verify-email?token=");
  const token = new URL(verifyLink).searchParams.get("token")!;
  await page.request.post("/api/v1/auth/verify-email", { headers: { origin: BASE }, data: { token } });
  const upload = await page.request.post("/api/v1/knowledge/uploads", {
    headers: { origin: BASE },
    multipart: {
      file: { name: "shipping.md", mimeType: "text/markdown", buffer: Buffer.from(SHIPPING) },
      audience: "public",
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const agentEmail = uniqueEmail("agent");
  const invite = await page.request.post("/api/v1/invitations", {
    headers: { origin: BASE },
    data: { email: agentEmail, role: "agent" },
  });
  expect(invite.status(), await invite.text()).toBe(201);

  // The agent joins and opens the knowledge page.
  const inviteToken = new URL(await waitForLink(agentEmail, "/invite?token=")).searchParams.get("token")!;
  const agentApi = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
  const accepted = await agentApi.post("/api/v1/invitations/accept", {
    data: { token: inviteToken, name: "Alan Turing", password: PASSWORD },
  });
  expect(accepted.status(), await accepted.text()).toBe(200);
  const agent = await browser.newContext({ storageState: await agentApi.storageState() });
  const agentPage = await agent.newPage();
  await agentPage.goto("/app/knowledge");

  await expect(sourceRow(agentPage, "shipping")).toBeVisible();
  await expect(agentPage.getByRole("button", { name: "Add source" })).toHaveCount(0);
  await expect(agentPage.getByRole("button", { name: /Actions for/ })).toHaveCount(0);
  await agent.close();
  await agentApi.dispose();
});
