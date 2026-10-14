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
