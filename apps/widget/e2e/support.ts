/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type BrowserContext, type Frame, type Page } from "@playwright/test";

export const API = process.env.E2E_API_URL ?? "http://localhost:8000";
/** Origin the staff API accepts cookie-authenticated writes from (CSRF check). */
export const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3000";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
/** Where "Powered by Docent" links: the API's SITE_URL, which defaults to its web origin. */
export const SITE_URL = (process.env.E2E_SITE_URL ?? WEB_ORIGIN).replace(/\/+$/, "");

export interface E2EState {
  widgetOrigin: string;
  /** Public widget id per demo host site. */
  widgets: { "lumen-notes": string; parcelwise: string };
}

export function hosts() {
  const port = Number(process.env.E2E_HOST_PORT ?? 5183);
  const other = Number(process.env.E2E_OTHER_PORT ?? 5184);
  return {
    /** The demo host on an allowed origin, same site as the widget (localhost). */
    host: `http://localhost:${port}`,
    /** The same demo host by IP: allowed, but a different site, so widget cookies are third-party. */
    thirdPartyHost: `http://127.0.0.1:${port}`,
    /** The demo host's second port, which is not on the widget's allowed list. */
    other: `http://localhost:${other}`,
  };
}

export const statePath = (): string => join(process.env.DOCENT_E2E_DIR as string, "state.json");

export function readState(): E2EState {
  return JSON.parse(readFileSync(statePath(), "utf8")) as E2EState;
}

/**
 * A made-up client IP for X-Forwarded-For. The local API trusts the header from
 * 127.0.0.1, so each run gets fresh rate limit buckets (anonymous chat allows
 * 10 messages per IP per hour). Behind Docker the header is ignored.
 */
export function fakeClientIp(): string {
  const byte = () => Math.floor(Math.random() * 254) + 1;
  return `10.${byte()}.${byte()}.${byte()}`;
}

/** The demo host's signed-in site (Parcelwise). */
export const APP = "/parcelwise";

/** Signs in on the demo host through its own form, as Diego (Starter plan). */
export async function signInAsDiego(page: Page): Promise<void> {
  const { host } = hosts();
  await page.goto(`${host}${APP}`);
  await page.getByRole("button", { name: /Sign in as Diego Ramos/ }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/** The host page's window.Docent, as these tests use it. */
type HostWindow = { Docent?: { v?: string; open(options?: { prefill?: string }): void; close(): void } };

/** Waits for loader.js to install the real Docent API on the host page. */
export async function waitForLoader(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as HostWindow).Docent?.v));
}

export async function openWidget(page: Page, prefill?: string): Promise<void> {
  await waitForLoader(page);
  await page.evaluate((text) => (window as unknown as HostWindow).Docent?.open(text === undefined ? undefined : { prefill: text }), prefill);
}

export async function closeWidget(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as HostWindow).Docent?.close());
}

/**
 * Clicks the launcher. It lives in a closed shadow root, so no selector can
 * reach it; click where it is drawn (56px, 20px from the bottom right).
 */
export async function clickLauncher(page: Page): Promise<void> {
  await waitForLoader(page);
  // The launcher mounts when the page goes idle.
  await page.waitForFunction(() => document.querySelector("docent-widget") !== null);
  const size = page.viewportSize();
  if (!size) throw new Error("no viewport");
  await page.mouse.click(size.width - 48, size.height - 48);
}

const isWidgetFrame = (f: Frame, widgetOrigin: string) =>
  !f.isDetached() && f.url().startsWith(`${widgetOrigin}/widget/v1/frame/`) && !f.url().includes("probe");

/** The live widget iframe (it sits in a closed shadow root, so find it by URL). */
export async function widgetFrame(page: Page): Promise<Frame> {
  const { widgetOrigin } = readState();
  await expect.poll(() => page.frames().some((f) => isWidgetFrame(f, widgetOrigin))).toBe(true);
  const frame = page.frames().find((f) => isWidgetFrame(f, widgetOrigin));
  if (!frame) throw new Error("widget frame not found");
  await frame.locator(".app").waitFor();
  return frame;
}

export async function send(frame: Frame, text: string): Promise<void> {
  const input = frame.locator("textarea");
  await input.fill(text);
  await input.press("Enter");
}

export interface WidgetCall {
  method: string;
  path: string;
  body: unknown;
  status?: number;
}

/** Records every request the widget frame makes to /v1/widget. */
export function recordWidgetCalls(context: BrowserContext): WidgetCall[] {
  const calls: WidgetCall[] = [];
  const byRequest = new Map<unknown, WidgetCall>();
  context.on("request", (req) => {
    const url = new URL(req.url());
    if (!url.pathname.startsWith("/v1/widget/")) return;
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    const call = { method: req.method(), path: url.pathname, body };
    byRequest.set(req, call);
    calls.push(call);
  });
  context.on("response", (res) => {
    const call = byRequest.get(res.request());
    if (call) call.status = res.status();
  });
  return calls;
}

/** "POST /v1/widget/conversations/<id>/messages" with ids replaced, for readable assertions. */
export const shape = (calls: WidgetCall[]): string[] =>
  calls.map((c) => `${c.method} ${c.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`);
