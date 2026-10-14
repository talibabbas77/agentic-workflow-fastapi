import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the real stack: the API on :8000, the worker on
 * :8001, Mailpit on :8025, and this app on :3000. The base URL must be
 * http://localhost:3000 because the API only accepts writes from that origin.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Each run signs up several fresh owners, and signups are limited per client
 * address. The local API trusts X-Forwarded-For from the Next proxy on the same
 * machine, so a made-up address per run keeps reruns within the hour working.
 * Production sits behind an edge proxy that replaces this header.
 */
const runIp = `10.${Array.from({ length: 3 }, () => Math.floor(Math.random() * 254) + 1).join(".")}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": runIp },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
