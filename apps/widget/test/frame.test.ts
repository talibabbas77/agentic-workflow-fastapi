import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/frame/app";
import { boot } from "../src/frame/boot";
import { memoryStore, type KeyValueStore } from "../src/frame/storage";

const HOST = "http://localhost:5173";
const WID = "wid_abcdefghijklmnop";
const CONV = "7b0c7a3e-1111-4222-8333-944455556666";
const VISITOR = "v_abcdefghijklmnopqrstu";

const config = (over: Record<string, unknown> = {}) => ({
  publicId: WID,
  name: "Lumen Notes",
  greeting: "Hi, ask me anything about Lumen Notes.",
  allowedOrigins: [HOST],
  anonymous: true,
  apiBase: "/v1/widget",
  ...over,
});

function page(cfg: Record<string, unknown>): void {
  document.head.replaceChildren();
  document.body.replaceChildren();
  const meta = document.createElement("meta");
  meta.setAttribute("name", "docent-widget");
  meta.setAttribute("content", JSON.stringify(cfg));
  document.head.appendChild(meta);
  const root = document.createElement("div");
  root.id = "docent";
  document.body.appendChild(root);
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const sse = (events: [string, unknown][]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const [event, data] of events) c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const session = (token: string, over: Record<string, unknown> = {}) =>
  json(201, {
    session_token: token,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    mode: "anonymous",
    visitor_id: VISITOR,
    user: { name: null },
    widget: { name: "Lumen Notes", greeting: "Hi, ask me anything about Lumen Notes." },
    ...over,
  });

const answer = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  role: "agent",
  content: "Refunds take **5 days** [1].",
  decision: { type: "answer", confidence: "high", reason: null, citations: [1] },
  citations: [
    {
      marker: 1,
      document_title: "Billing and refunds",
      heading_path: "Refunds",
      url: "https://help.example.com/refunds",
      excerpt: "Refunds are issued within 5 business days.",
    },
  ],
  created_at: null,
  ...over,
});

type Route = (url: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>;

interface Harness {
  parent: { postMessage: ReturnType<typeof vi.fn> };
  fetch: ReturnType<typeof vi.fn>;
  calls: { url: string; method: string; auth?: string; body?: unknown }[];
  storage: KeyValueStore;
  port: MessagePort;
  fromFrame: unknown[];
  app: () => App;
  send(msg: unknown): void;
}

/** Boots the frame with a fake parent window, a mocked fetch, and a real MessageChannel. */
function start(
  routes: Route[],
  init: { mode: "anonymous" | "identified"; token?: string } = { mode: "anonymous" },
  cfg = config(),
  seed: Record<string, string> = {},
): Harness {
  page(cfg);
  const calls: Harness["calls"] = [];
  const fetch = vi.fn(async (url: string, req: RequestInit = {}) => {
    const headers = (req.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: req.method ?? "GET",
      auth: headers.Authorization,
      body: typeof req.body === "string" ? JSON.parse(req.body) : undefined,
    });
    for (const route of routes) {
      const res = await route(url, req);
      if (res) return res;
    }
    throw new Error(`unexpected ${req.method} ${url}`);
  });
  const parent = { postMessage: vi.fn() };
  const target = new EventTarget();
  const win = {
    location: { ancestorOrigins: [HOST] },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    parent,
  };
  const storage = memoryStore();
  for (const [k, v] of Object.entries(seed)) storage.set(k, v);
  let app: App | null = null;
  const ok = boot({
    win: win as unknown as Window,
    doc: document,
    fetch: fetch as unknown as typeof globalThis.fetch,
    storage,
    parent: parent as unknown as Window,
    onApp: (a) => (app = a),
  });
  expect(ok).toBe(true);
  expect(parent.postMessage).toHaveBeenCalledWith({ source: "docent", type: "ready" }, HOST);

  const channel = new MessageChannel();
  const fromFrame: unknown[] = [];
  channel.port1.onmessage = (e) => fromFrame.push(e.data);
  const event = Object.assign(new Event("message"), {
    origin: HOST,
    source: parent,
    data: { source: "docent", type: "init", ...init },
    ports: [channel.port2],
  });
  target.dispatchEvent(event);
  return {
    parent,
    fetch,
    calls,
    storage,
    port: channel.port1,
    fromFrame,
    app: () => {
      if (!app) throw new Error("init was not accepted");
      return app;
    },
    send: (msg) => channel.port1.postMessage(msg),
  };
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const texts = (sel: string) => [...document.querySelectorAll(sel)].map((n) => n.textContent);

function type(text: string): void {
  const input = $<HTMLTextAreaElement>("textarea");
  if (!input) throw new Error("no input");
  input.value = text;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

const sessionRoute =
  (...responses: (() => Response)[]): Route =>
  (url, req) =>
    url === "/v1/widget/sessions" && req.method === "POST" ? (responses.shift() ?? responses[0])?.() : undefined;

afterEach(() => {
  vi.useRealTimers();
});

describe("frame boot", () => {
  it("renders nothing and says nothing when the parent origin is not allowed", () => {
    page(config({ allowedOrigins: ["https://app.example.com"] }));
    const parent = { postMessage: vi.fn() };
    const ok = boot({
      win: { location: { ancestorOrigins: [HOST] }, addEventListener: vi.fn(), parent } as unknown as Window,
      doc: document,
      fetch: vi.fn() as unknown as typeof fetch,
      storage: memoryStore(),
      parent: parent as unknown as Window,
    });
    expect(ok).toBe(false);
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect($("#docent")?.childNodes.length).toBe(0);
  });

  it("ignores init from another window or origin", () => {
    page(config());
    const parent = { postMessage: vi.fn() };
    const target = new EventTarget();
    const onApp = vi.fn();
    boot({
      win: {
        location: { ancestorOrigins: [HOST] },
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        parent,
      } as unknown as Window,
      doc: document,
      fetch: vi.fn() as unknown as typeof fetch,
      storage: memoryStore(),
      parent: parent as unknown as Window,
      onApp,
    });
    const { port2 } = new MessageChannel();
    const data = { source: "docent", type: "init", mode: "anonymous" };
    for (const [origin, source] of [
      ["http://evil.example", parent],
      [HOST, { postMessage: vi.fn() }],
    ] as const) {
      target.dispatchEvent(Object.assign(new Event("message"), { origin, source, data, ports: [port2] }));
    }
    expect(onApp).not.toHaveBeenCalled();
    expect($("#docent")?.childNodes.length).toBe(0);
  });
});

describe("frame app, anonymous", () => {
  it("warms a session, loads the conversation on open, streams a reply, and resets", async () => {
    const h = start([
      sessionRoute(() => session("st_1")),
      (url) => (url === "/v1/widget/conversations" ? json(201, { id: CONV, status: "open", messages: [] }) : undefined),
      (url) =>
        url === `/v1/widget/conversations/${CONV}/messages`
          ? sse([
              ["status", { stage: "searching" }],
              ["status", { stage: "writing" }],
              ["message", answer()],
            ])
          : undefined,
      (url, req) => (url === "/v1/widget/sessions/current" && req.method === "DELETE" ? new Response(null, { status: 204 }) : undefined),
    ]);

    // Warm session on init, no visitor id yet; the returned one is kept in the frame's storage.
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.calls[0].body).toEqual({ widget: WID, parent_origin: HOST });
    await vi.waitFor(() => expect(h.storage.get(`docent:visitor:${WID}`)).toBe(VISITOR));
    expect($(".name")?.textContent).toBe("Lumen Notes");
    expect(texts(".greeting")).toEqual(["Hi, ask me anything about Lumen Notes."]);

    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.calls.map((c) => c.url)).toContain("/v1/widget/conversations"));
    const conv = h.calls.find((c) => c.url === "/v1/widget/conversations");
    expect(conv?.auth).toBe("Bearer st_1");
    expect(conv?.body).toEqual({});
    await vi.waitFor(() => expect(h.storage.get(`docent:conversation:${WID}`)).toBe(CONV));

    type("How long do refunds take?");
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    expect(texts(".msg.visitor .plain")).toEqual(["How long do refunds take?"]);
    const reply = $(".msg.agent:not(.greeting)");
    expect(reply?.querySelector("strong")?.textContent).toBe("5 days");
    expect(reply?.querySelector("button.ref")?.textContent).toBe("1");
    const chip = reply?.querySelector<HTMLButtonElement>(".chip");
    expect(chip?.textContent).toContain("Billing and refunds > Refunds");
    chip?.click();
    expect(chip?.getAttribute("aria-expanded")).toBe("true");
    expect(reply?.querySelector(".detail a")?.getAttribute("href")).toBe("https://help.example.com/refunds");
    // Status line is cleared and the composer is usable again.
    await vi.waitFor(() => expect($(".status")?.textContent).toBe(""));
    expect($<HTMLTextAreaElement>("textarea")?.value).toBe("");

    // Reset: revoke on the server, clear storage, then tell the loader.
    h.send({ type: "reset", mode: "anonymous" });
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "reset_done" }));
    const revoke = h.calls.find((c) => c.method === "DELETE");
    expect(revoke).toMatchObject({ url: "/v1/widget/sessions/current", auth: "Bearer st_1" });
    expect(h.storage.get(`docent:visitor:${WID}`)).toBeNull();
    expect(h.storage.get(`docent:conversation:${WID}`)).toBeNull();
    expect($(".msg.agent:not(.greeting)")).toBeNull();
  });

  it("sends the stored visitor id and resume id so a reload keeps the thread", async () => {
    // A previous page in this tab left these in the frame's sessionStorage.
    const h = start(
      [
        sessionRoute(() => session("st_2")),
        (url) =>
          url === "/v1/widget/conversations"
            ? json(201, { id: CONV, status: "open", messages: [{ ...answer(), id: "old" }] })
            : undefined,
      ],
      { mode: "anonymous" },
      config(),
      { [`docent:visitor:${WID}`]: VISITOR, [`docent:conversation:${WID}`]: CONV },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    const sessions = h.calls.filter((c) => c.url === "/v1/widget/sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].body).toEqual({ widget: WID, parent_origin: HOST, visitor_id: VISITOR });
    expect(h.calls.find((c) => c.url === "/v1/widget/conversations")?.body).toEqual({ resume_id: CONV });
  });

  it("escalation: asks for an email and posts it to contact", async () => {
    const h = start([
      sessionRoute(() => session("st_3")),
      (url) => (url === "/v1/widget/conversations" ? json(201, { id: CONV, status: "open", messages: [] }) : undefined),
      (url) =>
        url.endsWith("/messages")
          ? sse([["message", answer({ content: "I will pass this to the team.", citations: [], decision: { type: "escalate", confidence: null, reason: "asked for human", citations: [] } })]])
          : undefined,
      (url) => (url.endsWith("/contact") ? new Response(null, { status: 204 }) : undefined),
    ]);
    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.app().conversationId()).toBe(CONV));
    type("I want a person");
    await vi.waitFor(() => expect($("form.contact")).not.toBeNull());
    expect($(".note")?.textContent).toContain("Where should the team reply?");

    const email = $<HTMLInputElement>("input.email");
    if (!email) throw new Error("no email field");
    email.value = "not an email";
    $<HTMLFormElement>("form.contact")?.dispatchEvent(new Event("submit", { cancelable: true }));
    expect($(".field-error")?.textContent).toContain("Enter an email address");

    email.value = "sam@example.com";
    $<HTMLFormElement>("form.contact")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect($(".done")?.textContent).toBe("Thanks. The team will reply to sam@example.com."));
    const contact = h.calls.find((c) => c.url.endsWith("/contact"));
    expect(contact).toMatchObject({ url: `/v1/widget/conversations/${CONV}/contact`, body: { email: "sam@example.com" } });
  });

  it("counts unread replies while closed", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const h = start([
      sessionRoute(() => session("st_4")),
      (url) => (url === "/v1/widget/conversations" ? json(201, { id: CONV, status: "open", messages: [] }) : undefined),
      async (url) => (url.endsWith("/messages") ? (await gate, sse([["message", answer()]])) : undefined),
    ]);
    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.app().conversationId()).toBe(CONV));
    // Send, then close the panel while the agent is still working.
    type("Question");
    h.send({ type: "close" });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "unread", count: 1 }));
    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "unread", count: 0 }));
  });

  it("rate limited: shows a calm notice and puts the text back", async () => {
    const h = start([
      sessionRoute(() => session("st_5")),
      (url) => (url === "/v1/widget/conversations" ? json(201, { id: CONV, status: "open", messages: [] }) : undefined),
      (url) =>
        url.endsWith("/messages")
          ? json(429, { error: { code: "rate_limited", message: "Too many" } }, { "retry-after": "600" })
          : undefined,
    ]);
    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.app().conversationId()).toBe(CONV));
    type("One more question");
    await vi.waitFor(() => expect($(".notice")?.textContent).toContain("Try again in 10 minutes."));
    expect($<HTMLTextAreaElement>("textarea")?.value).toBe("One more question");
    expect($(".msg.visitor")).toBeNull();
  });

  it("session_expired: creates a new session and retries the call once", async () => {
    let conversations = 0;
    const h = start([
      sessionRoute(
        () => session("st_old"),
        () => session("st_new"),
      ),
      (url, req) => {
        if (url !== "/v1/widget/conversations") return undefined;
        conversations++;
        const auth = (req.headers as Record<string, string>).Authorization;
        return auth === "Bearer st_old"
          ? json(401, { error: { code: "session_expired", message: "Start again." } })
          : json(201, { id: CONV, status: "open", messages: [] });
      },
    ]);
    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.app().conversationId()).toBe(CONV));
    expect(conversations).toBe(2);
    expect(h.calls.filter((c) => c.url === "/v1/widget/sessions")).toHaveLength(2);
  });

  it("anonymous disabled: shows the sign in message without calling the API on open", async () => {
    const h = start([], { mode: "anonymous" }, config({ anonymous: false }));
    h.send({ type: "open" });
    await vi.waitFor(() => expect($(".state-title")?.textContent).toBe("Chat is available after you sign in."));
    expect(h.calls).toHaveLength(0);
    expect($<HTMLFormElement>("form.composer")?.hidden).toBe(true);
  });
});

describe("frame app, identified", () => {
  it("uses the init token, and on token_invalid asks the loader for a fresh one once", async () => {
    const h = start(
      [
        (url, req) => {
          if (url !== "/v1/widget/sessions") return undefined;
          const body = JSON.parse(String(req.body));
          return body.token === "jwt-1"
            ? json(401, { error: { code: "token_invalid", message: "already used" } })
            : session("st_id", { mode: "identified", visitor_id: null, user: { name: "Sam Ortiz" } });
        },
      ],
      { mode: "identified", token: "jwt-1" },
    );
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "token" }));
    h.send({ type: "token", token: "jwt-2" });
    await vi.waitFor(() => expect($(".sub")?.textContent).toBe("Signed in as Sam Ortiz"));
    const bodies = h.calls.map((c) => c.body as Record<string, unknown>);
    expect(bodies.map((b) => b.token)).toEqual(["jwt-1", "jwt-2"]);
    expect(bodies.every((b) => !("visitor_id" in b))).toBe(true);
    expect(h.storage.get(`docent:visitor:${WID}`)).toBeNull();
  });

  it("shows the sign in state when the loader has no token", async () => {
    const h = start(
      [(url) => (url === "/v1/widget/sessions" ? json(401, { error: { code: "token_invalid", message: "expired" } }) : undefined)],
      { mode: "identified", token: "jwt-old" },
    );
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "token" }));
    h.send({ type: "token", token: null });
    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.fromFrame.filter((m) => (m as { type: string }).type === "token").length).toBe(2));
    h.send({ type: "token", token: null });
    await vi.waitFor(() => expect($(".state-title")?.textContent).toBe("Sign in again"));
  });
});
