// Phase 4 checks 2 and 4: where the widget may run, and who may talk to it.
// Plus: the signed-in site's widget (anonymous chat off) refuses a session
// that has no signed token, however it is asked for.
import { expect, test, type Frame, type Page } from "@playwright/test";
import { API, fakeClientIp, hosts, openWidget, readState, recordWidgetCalls, shape, widgetFrame } from "./support";

test.use({ extraHTTPHeaders: { "x-forwarded-for": fakeClientIp() } });

test("check 2: the same snippet on a site that is not allowed shows no chat", async ({ page, request }) => {
  const { host, thirdPartyHost, other } = hosts();
  const { widgets, widgetOrigin } = readState();
  const widget = widgets["lumen-notes"];

  // The frame page tells the browser exactly which sites may embed it.
  const framePage = await request.get(`${widgetOrigin}/widget/v1/frame/${widget}`);
  const csp = framePage.headers()["content-security-policy"] ?? "";
  const ancestors = /frame-ancestors ([^;]+)/.exec(csp)?.[1].split(" ") ?? [];
  expect(ancestors.sort()).toEqual([host, thirdPartyHost].sort());

  const calls = recordWidgetCalls(page.context());
  await page.goto(`${other}/lumen-notes`);
  await openWidget(page);
  // Give the browser time to load (and refuse) the frame.
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await page.waitForTimeout(1500);

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const rendered = await frame
      .locator("#docent .app")
      .count()
      .catch(() => 0);
    expect(rendered, `frame ${frame.url()} must not render the chat`).toBe(0);
  }
  expect(shape(calls)).toEqual([]);
});

/** Index of an iframe in window.frames of the page, as another frame would address it. */
async function frameIndex(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLIFrameElement>(sel);
    for (let i = 0; i < window.frames.length; i++) if (window.frames[i] === el?.contentWindow) return i;
    return -1;
  }, selector);
}

async function frameAt(page: Page, prefix: string): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(prefix))).toBe(true);
  const frame = page.frames().find((f) => f.url().startsWith(prefix));
  if (!frame) throw new Error(`no frame at ${prefix}`);
  await frame.waitForLoadState();
  return frame;
}

test("check 4: messages from another origin or another window are ignored", async ({ page }) => {
  const { host, other } = hosts();
  const { widgets, widgetOrigin } = readState();
  const widget = widgets["lumen-notes"];

  // The real widget, started by the loader.
  await page.goto(`${host}/lumen-notes`);
  await openWidget(page);
  const real = await widgetFrame(page);
  await real.evaluate(() => {
    const w = window as unknown as { inits: number };
    w.inits = 0;
    addEventListener("message", (e) => {
      if ((e.data as { type?: string } | null)?.type === "init") w.inits++;
    });
  });

  // A second, uninitialized widget frame (a probe), and a hostile frame on
  // another origin, both inside the allowed page.
  const probeUrl = `${widgetOrigin}/widget/v1/frame/${widget}?probe=1`;
  const hostileUrl = `${other}/not-a-page`;
  await page.evaluate(
    ([probeSrc, hostileSrc]) => {
      for (const [id, src] of [
        ["probe", probeSrc],
        ["hostile", hostileSrc],
      ]) {
        const f = document.createElement("iframe");
        f.id = id;
        f.src = src;
        document.body.appendChild(f);
      }
    },
    [probeUrl, hostileUrl],
  );
  const probe = await frameAt(page, probeUrl);
  const hostile = await frameAt(page, hostileUrl);
  const probeIndex = await frameIndex(page, "#probe");
  expect(probeIndex).toBeGreaterThanOrEqual(0);

  // The probe announced itself with "ready" (right origin, but not the
  // loader's own iframe). The hostile frame forges an init with a port, port
  // style commands, and a "ready" to the loader. The host page forges a
  // "ready" too, from the wrong origin.
  await hostile.evaluate((index) => {
    const target = window.top?.frames[index];
    if (!target) throw new Error("probe not reachable");
    const channel = new MessageChannel();
    const got: unknown[] = [];
    (window as unknown as { got: unknown[] }).got = got;
    channel.port1.onmessage = (e) => got.push(e.data);
    target.postMessage({ source: "docent", type: "init", mode: "identified", token: "forged" }, "*", [channel.port2]);
    target.postMessage({ type: "open" }, "*");
    target.postMessage({ type: "reset", mode: "anonymous" }, "*");
    window.top?.postMessage({ source: "docent", type: "ready" }, "*");
  }, probeIndex);
  await page.evaluate(() => window.postMessage({ source: "docent", type: "ready" }, "*"));
  await page.waitForTimeout(1000);

  // Nothing happened: the probe stays blank, the hostile port got nothing,
  // and the loader never re-initialized its frame.
  expect(await probe.locator("#docent > *").count()).toBe(0);
  expect(await hostile.evaluate(() => (window as unknown as { got: unknown[] }).got)).toEqual([]);
  expect(await real.evaluate(() => (window as unknown as { inits: number }).inits)).toBe(0);

  // Controls, so the checks above cannot pass by accident:
  // a "ready" from the loader's own frame does re-initialize it,
  await real.evaluate((parentOrigin) => window.parent.postMessage({ source: "docent", type: "ready" }, parentOrigin), host);
  await expect.poll(() => real.evaluate(() => (window as unknown as { inits: number }).inits)).toBe(1);
  // and the probe accepts an init from its real parent.
  await page.evaluate((origin) => {
    const f = document.querySelector<HTMLIFrameElement>("#probe");
    const channel = new MessageChannel();
    (window as unknown as { keep: MessagePort }).keep = channel.port1;
    f?.contentWindow?.postMessage({ source: "docent", type: "init", mode: "anonymous" }, origin, [channel.port2]);
  }, widgetOrigin);
  await expect(probe.locator("#docent .app")).toBeVisible();
});

test("anonymous chat off: a session without a signed token is refused, in the API and in the frame", async ({
  page,
  request,
}) => {
  const { host } = hosts();
  const { widgets, widgetOrigin } = readState();

  // Straight at the API, with every header a browser would send from the frame.
  const crafted = await request.post(`${API}/v1/widget/sessions`, {
    headers: { origin: widgetOrigin },
    data: { widget: widgets.parcelwise, parent_origin: host },
  });
  expect(crafted.status()).toBe(403);
  expect(((await crafted.json()) as { error: { code: string } }).error.code).toBe("anonymous_disabled");

  // And through the real loader: someone adds the snippet without a token to
  // the signed-out page. The chat opens to a sign-in message, not a session.
  const calls = recordWidgetCalls(page.context());
  await page.goto(`${host}/parcelwise`);
  await page.evaluate(
    ([src, id]) => {
      const script = document.createElement("script");
      script.src = src;
      script.dataset.widget = id;
      document.body.appendChild(script);
    },
    [`${widgetOrigin}/widget/v1/loader.js`, widgets.parcelwise],
  );
  await openWidget(page);
  const frame = await widgetFrame(page);
  await expect(frame.locator(".state-title")).toHaveText("Chat is available after you sign in.");
  expect(shape(calls).filter((c) => c === "POST /v1/widget/conversations")).toEqual([]);
  expect(calls.filter((c) => c.path === "/v1/widget/sessions" && c.status === 201)).toEqual([]);
});
