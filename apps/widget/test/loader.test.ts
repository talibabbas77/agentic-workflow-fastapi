import { afterEach, describe, expect, it, vi } from "vitest";
import { createLoader, type Loader } from "../src/loader/loader";
import { RESET_TIMEOUT_MS } from "../src/shared/protocol";

const WIDGET = "http://localhost:8000";
const WID = "wid_abcdefghijklmnop";

const shadow = (): ShadowRoot => {
  const host = document.querySelector("docent-widget");
  if (!host?.shadowRoot) throw new Error("launcher not mounted");
  return host.shadowRoot;
};
const launcher = (): HTMLButtonElement => shadow().querySelector("button") as HTMLButtonElement;
const iframe = (): HTMLIFrameElement | null => shadow().querySelector("iframe");

interface FakeFrame {
  win: { postMessage: ReturnType<typeof vi.fn> };
  /** Resolves with the frame's end of the channel once the loader posts init. */
  port: Promise<MessagePort>;
  init: () => unknown;
}

/** Gives the created iframe a fake window, then sends "ready" from it. */
function attachFrame(): FakeFrame {
  const frame = iframe();
  if (!frame) throw new Error("no iframe");
  let resolvePort: (p: MessagePort) => void = () => undefined;
  const port = new Promise<MessagePort>((r) => (resolvePort = r));
  let initMsg: unknown;
  const win = {
    postMessage: vi.fn((msg: unknown, _origin: string, transfer?: MessagePort[]) => {
      initMsg = msg;
      if (transfer?.[0]) resolvePort(transfer[0]);
    }),
  };
  Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => win });
  return { win, port, init: () => initMsg };
}

function ready(source: unknown, origin = WIDGET): void {
  window.dispatchEvent(
    new MessageEvent("message", { origin, source: source as Window, data: { source: "docent", type: "ready" } }),
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Collects what the loader sends over the port. */
function listen(port: MessagePort): unknown[] {
  const got: unknown[] = [];
  port.onmessage = (e) => got.push(e.data);
  return got;
}

let current: Loader | null = null;
function makeLoader(): Loader {
  current = createLoader({ win: window, doc: document, origin: WIDGET, shadowMode: "open" });
  return current;
}

afterEach(async () => {
  vi.useRealTimers();
  // Let any mount scheduled by this test happen before cleaning up, so it
  // cannot land in the next test's document.
  await flush();
  await flush();
  document.body.replaceChildren();
  current = null;
});

describe("loader", () => {
  it("mounts a launcher and creates the iframe lazily on first open", async () => {
    const { api } = makeLoader();
    api.init({ widget: WID });
    await flush();
    await flush();
    expect(launcher().getAttribute("aria-label")).toBe("Open support chat");
    expect(launcher().getAttribute("aria-expanded")).toBe("false");
    expect(iframe()).toBeNull();

    api.open();
    const frame = iframe();
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("src")).toBe(`${WIDGET}/widget/v1/frame/${WID}`);
    expect(frame?.title).toBe("Support chat");
    expect(frame?.hasAttribute("allow")).toBe(false);
    expect(frame?.getAttribute("referrerpolicy")).toBe("strict-origin");
    expect(frame?.hidden).toBe(false);
    expect(launcher().getAttribute("aria-expanded")).toBe("true");
    expect(launcher().getAttribute("aria-label")).toBe("Close support chat");

    api.close();
    expect(frame?.hidden).toBe(true);
    expect(launcher().getAttribute("aria-label")).toBe("Open support chat");
  });

  it("ignores ready from other origins and other windows; answers its own frame with init and a port", async () => {
    const { api } = makeLoader();
    api.init({ widget: WID });
    api.open();
    const fake = attachFrame();

    ready(fake.win, "http://evil.example");
    ready({ postMessage: vi.fn() });
    ready(window);
    await flush();
    expect(fake.win.postMessage).not.toHaveBeenCalled();

    ready(fake.win);
    const port = await fake.port;
    expect(fake.win.postMessage).toHaveBeenCalledTimes(1);
    const [msg, targetOrigin] = fake.win.postMessage.mock.calls[0];
    expect(targetOrigin).toBe(WIDGET);
    expect(msg).toEqual({ source: "docent", type: "init", mode: "anonymous" });
    // The panel is open, so the loader tells the frame right after init.
    const got = listen(port);
    await vi.waitFor(() => expect(got).toContainEqual({ type: "open" }));
  });

  it("identified: warms the iframe at init, passes a token, and answers token requests", async () => {
    let n = 0;
    const getToken = vi.fn(async () => `jwt-${++n}`);
    const { api } = makeLoader();
    api.init({ widget: WID, getToken });
    await vi.waitFor(() => expect(iframe()).not.toBeNull());
    expect(iframe()?.hidden).toBe(true);

    const fake = attachFrame();
    ready(fake.win);
    const port = await fake.port;
    expect(fake.init()).toEqual({ source: "docent", type: "init", mode: "identified", token: "jwt-1" });

    const got = listen(port);
    port.postMessage({ type: "token" });
    await vi.waitFor(() => expect(got).toContainEqual({ type: "token", token: "jwt-2" }));

    getToken.mockRejectedValueOnce(new Error("signed out"));
    port.postMessage({ type: "token" });
    await vi.waitFor(() => expect(got).toContainEqual({ type: "token", token: null }));
  });

  it("shows an unread dot and closes when the frame asks", async () => {
    const { api } = makeLoader();
    api.init({ widget: WID });
    api.open();
    const fake = attachFrame();
    ready(fake.win);
    const port = await fake.port;

    port.postMessage({ type: "close" });
    await vi.waitFor(() => expect(iframe()?.hidden).toBe(true));
    port.postMessage({ type: "unread", count: 2 });
    const dot = () => shadow().querySelector<HTMLElement>(".d");
    await vi.waitFor(() => expect(dot()?.hidden).toBe(false));
    expect(launcher().getAttribute("aria-label")).toBe("Open support chat, 2 new messages");

    api.open();
    expect(dot()?.hidden).toBe(true);
  });

  it("tells the frame the layout, and sizes the iframe when the frame asks to expand", async () => {
    const { api } = makeLoader();
    api.init({ widget: WID });
    api.open();
    const fake = attachFrame();
    ready(fake.win);
    const port = await fake.port;
    const got = listen(port);
    await vi.waitFor(() => expect(got).toContainEqual({ type: "layout", compact: false }));

    expect(iframe()?.className).toBe("f");
    port.postMessage({ type: "expand", expanded: true });
    await vi.waitFor(() => expect(iframe()?.className).toBe("f x"));
    port.postMessage({ type: "expand", expanded: "yes" });
    await flush();
    expect(iframe()?.className).toBe("f x");
    port.postMessage({ type: "expand", expanded: false });
    await vi.waitFor(() => expect(iframe()?.className).toBe("f"));
  });

  it("open({ prefill }) hands the text to the frame after open; bad text is refused", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { api } = makeLoader();
    api.init({ widget: WID });
    api.open({ prefill: "How do I export a note?" });
    const fake = attachFrame();
    ready(fake.win);
    const got = listen(await fake.port);
    await vi.waitFor(() => expect(got).toContainEqual({ type: "prefill", text: "How do I export a note?" }));
    expect(got.findIndex((m) => (m as { type: string }).type === "open")).toBeLessThan(
      got.findIndex((m) => (m as { type: string }).type === "prefill"),
    );

    got.length = 0;
    api.open({ prefill: "x".repeat(1001) });
    api.open({ prefill: 42 as unknown as string });
    await vi.waitFor(() => expect(got.filter((m) => (m as { type: string }).type === "open")).toHaveLength(2));
    await flush();
    expect(got.some((m) => (m as { type: string }).type === "prefill")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("Docent: prefill must be text of at most 1000 characters.");
    warn.mockRestore();
  });

  it("switching to identified after an anonymous start resets the frame", async () => {
    const { api } = makeLoader();
    api.init({ widget: WID });
    api.open();
    const fake = attachFrame();
    ready(fake.win);
    const got = listen(await fake.port);
    api.init({ widget: WID, getToken: async () => "jwt" });
    await vi.waitFor(() => expect(got).toContainEqual({ type: "reset", mode: "identified" }));
  });
});

describe("Docent.reset()", () => {
  it("resolves at once when there is no frame", async () => {
    const { api } = makeLoader();
    api.init({ widget: WID });
    await expect(api.reset()).resolves.toBeUndefined();
  });

  it("resolves when the frame answers reset_done", async () => {
    const { api } = makeLoader();
    api.init({ widget: WID, getToken: async () => "jwt" });
    await vi.waitFor(() => expect(iframe()).not.toBeNull());
    const fake = attachFrame();
    ready(fake.win);
    const port = await fake.port;
    port.onmessage = (e) => {
      if (e.data?.type === "reset") {
        expect(e.data).toEqual({ type: "reset", mode: "anonymous" });
        port.postMessage({ type: "reset_done" });
      }
    };
    const started = Date.now();
    await api.reset();
    expect(Date.now() - started).toBeLessThan(RESET_TIMEOUT_MS);
  });

  it("resolves after the timeout when the frame never answers", async () => {
    const { api } = makeLoader();
    api.init({ widget: WID });
    api.open();
    const fake = attachFrame();
    ready(fake.win);
    await fake.port; // connected, but the frame side stays silent

    vi.useFakeTimers();
    let done = false;
    const p = api.reset().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(RESET_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });
});
