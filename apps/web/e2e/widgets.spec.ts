import { createPrivateKey, createPublicKey, generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signUp } from "./signup";

function publicPem(namedCurve: string) {
  return generateKeyPairSync("ec", { namedCurve }).publicKey.export({ type: "spki", format: "pem" }).toString();
}

test("an owner creates a widget, adds and retires keys, and gets the install snippet", async ({ page }) => {
  await signUp(page, "Ada Lovelace", "Widgets");
  await page.goto("/app");
  await page.getByRole("link", { name: /Install the widget/ }).click();
  await expect(page).toHaveURL(/\/app\/widgets$/);
  await expect(page.getByRole("heading", { name: "No widgets yet" })).toBeVisible();

  // An origin needs a scheme; the API says so on the field.
  await page.getByRole("button", { name: "Create widget" }).click();
  const create = page.getByRole("dialog", { name: "Create a widget" });
  await create.getByLabel("Name").fill("Help center");
  await create.getByRole("textbox", { name: "Site 1" }).fill("app.example.com");
  await create.getByRole("button", { name: "Create widget" }).click();
  await expect(create).toContainText("app.example.com is not an origin like https://app.example.com.");
  await create.getByRole("textbox", { name: "Site 1" }).fill("https://App.Example.com/");
  await create.getByRole("button", { name: "Create widget" }).click();

  await expect(page).toHaveURL(/\/app\/widgets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Help center", level: 1 })).toBeVisible();
  await expect(create).toBeHidden();
  const notifications = page.getByRole("region", { name: "Notifications" });
  await expect(notifications).toContainText("Widget created");
  await notifications.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("textbox", { name: "Site 1" })).toHaveValue("https://app.example.com");
  const publicId = (await page.getByText(/^wid_[A-Za-z0-9]{16}$/).first().textContent())!;
  await expect(page.getByRole("region", { name: "HTML code" })).toContainText(`data-widget="${publicId}"`);

  // Generate a key in the browser; only the private half comes back, once, as a download.
  const keys = page.getByRole("region", { name: "Signing keys" });
  await expect(keys).toContainText("No keys yet");
  await keys.getByRole("button", { name: "Add key" }).click();
  await page.getByRole("dialog", { name: "Add a signing key" }).getByRole("button", { name: "Generate key" }).click();
  const added = page.getByRole("dialog", { name: "Key added" });
  const kid = (await added.getByText(/^key_[A-Za-z0-9]{12}$/).textContent())!;
  const downloading = page.waitForEvent("download");
  await added.getByRole("button", { name: "Download private key" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`docent-${kid}.pem`);

  const pem = await readFile((await download.path())!, "utf8");
  const lines = pem.trimEnd().split("\n");
  expect(lines[0]).toBe("-----BEGIN PRIVATE KEY-----");
  expect(lines.at(-1)).toBe("-----END PRIVATE KEY-----");
  expect(lines.slice(1, -2).every((line) => line.length === 64)).toBe(true);
  const privateKey = createPrivateKey(pem);
  expect(privateKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");

  // The public key Docent stored is the other half of the downloaded private key.
  const widgets = (await (await page.request.get("/api/v1/widgets")).json()) as {
    keys: { kid: string; public_jwk: JsonWebKey }[];
  }[];
  const stored = widgets[0]!.keys.find((key) => key.kid === kid)!.public_jwk;
  const derived = createPublicKey(privateKey).export({ format: "jwk" });
  expect({ x: stored.x, y: stored.y }).toEqual({ x: derived.x, y: derived.y });

  await added.getByRole("button", { name: "Done" }).click();
  await expect(added).toBeHidden();
  await expect(keys.getByRole("row").filter({ hasText: kid })).toContainText("Active");
  await expect(keys.getByText("Active", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Install" })).toContainText(kid);

  // Bring your own public key: private keys and other curves are refused in the browser.
  await keys.getByRole("button", { name: "Add key" }).click();
  const own = page.getByRole("dialog", { name: "Add a signing key" });
  await own.getByText("Use my own public key", { exact: true }).click();
  const field = own.getByRole("textbox", { name: "Public key" });
  await field.fill(pem);
  await own.getByRole("button", { name: "Add key" }).click();
  await expect(own).toContainText("This is a private key.");
  await field.fill(publicPem("secp384r1"));
  await own.getByRole("button", { name: "Add key" }).click();
  await expect(own).toContainText("This is not an EC P-256 key.");
  await field.fill(publicPem("prime256v1"));
  await own.getByRole("button", { name: "Add key" }).click();
  await expect(own).toBeHidden();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Signing key added");
  await expect(keys.getByText("Active", { exact: true })).toHaveCount(2);
  await expect(keys.getByRole("button", { name: "Add key" })).toBeDisabled();

  // Retire the first key behind a confirmation.
  await keys.getByRole("button", { name: `Retire ${kid}` }).click();
  const retire = page.getByRole("dialog", { name: `Retire ${kid}?` });
  await retire.getByRole("button", { name: "Retire key" }).click();
  await expect(retire).toBeHidden();
  await expect(keys.getByRole("row").filter({ hasText: kid })).toContainText("Retired");
  await expect(keys.getByRole("button", { name: "Add key" })).toBeEnabled();
});

test("an owner edits the questions the widget suggests under its greeting", async ({ page }) => {
  await signUp(page, "Grace Hopper", "Suggestions");
  // The test above covers the create dialog; start from a saved widget.
  const created = await page.request.post("/api/v1/widgets", {
    headers: { origin: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
    data: { name: "Help center", allowed_origins: ["https://app.example.com"] },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/app/widgets/${id}`);

  const settings = page.getByRole("region", { name: "Settings" });
  const field = settings.getByRole("group", { name: "Suggested questions" });
  const save = settings.getByRole("button", { name: "Save changes" });
  await expect(field.getByRole("textbox")).toHaveCount(0);
  await expect(save).toBeDisabled();

  // Each new row takes focus, so typing goes straight into it.
  const add = field.getByRole("button", { name: "Add question" });
  await add.click();
  await expect(field.getByRole("textbox", { name: "Question 1" })).toBeFocused();
  await page.keyboard.type("How do I reset my password?");
  await add.click();
  await page.keyboard.type("  how do I RESET   my password? ");
  await save.click();
  await expect(field).toContainText(
    '"how do I RESET my password?" is in the list twice. Each question must be different.',
  );

  await field.getByRole("textbox", { name: "Question 2" }).fill("Can I pay yearly?");
  await add.click();
  await page.keyboard.type("Where are my invoices?");
  await add.click();
  await page.keyboard.type("How do I add a teammate?");
  // Four is the most a widget shows.
  await expect(add).toBeHidden();
  await field.getByRole("button", { name: "Remove question 3" }).click();
  await expect(add).toBeVisible();
  await save.click();
  const notifications = page.getByRole("region", { name: "Notifications" });
  await expect(notifications).toContainText("Widget saved");

  const wanted = ["How do I reset my password?", "Can I pay yearly?", "How do I add a teammate?"];
  const stored = (await (await page.request.get(`/api/v1/widgets/${id}`)).json()) as { suggestions: string[] };
  expect(stored.suggestions).toEqual(wanted);
  await page.reload();
  const rows = page.getByRole("group", { name: "Suggested questions" }).getByRole("textbox");
  await expect.poll(() => rows.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(
    wanted,
  );
});
