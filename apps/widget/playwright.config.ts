/// <reference types="node" />
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 4 browser checks against the real stack: the API on :8000 (serving the
 * widget from apps/widget/dist), the worker, and Mailpit. The demo host is
 * started here on its own ports so it never collides with one you run by hand
 * on 5173/5174. Override with E2E_HOST_PORT and E2E_OTHER_PORT.
 */
const HOST_PORT = Number(process.env.E2E_HOST_PORT ?? 5183);
const OTHER_PORT = Number(process.env.E2E_OTHER_PORT ?? 5184);

// One temp folder per run, shared with workers and the demo host through the
// environment (the config file is evaluated again in every worker).
process.env.DOCENT_E2E_DIR ??= mkdtempSync(join(tmpdir(), "docent-widget-e2e-"));
process.env.E2E_HOST_PORT = String(HOST_PORT);
process.env.E2E_OTHER_PORT = String(OTHER_PORT);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      // Full Chromium (not the headless shell): it honors the profile setting
      // that blocks third-party cookies, which the anonymous spec relies on.
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
    {
      // WebKit blocks third-party cookies by default. The anonymous flow and
      // the panel's controls (focus, sizing) run here; the rest is browser
      // independent.
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: /(anonymous|panel)\.spec\.ts$/,
    },
  ],
  webServer: {
    command: "pnpm --filter @docent/demo-host start",
    url: `http://127.0.0.1:${HOST_PORT}/lumen-notes`,
    env: {
      PORT: String(HOST_PORT),
      OTHER_PORT: String(OTHER_PORT),
      DEMO_KEYS_DIR: process.env.DOCENT_E2E_DIR,
    },
    // Fails with a clear message if something already listens on the port.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
