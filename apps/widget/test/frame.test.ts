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
    expires_in: 1800,
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
  decision: { type: "answer", confidence: "high", reason: null, citations: [1], account_facts: [] },
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

const conversationRoute =
  (body: Record<string, unknown> = {}): Route =>
  (url) =>
    url === "/v1/widget/conversations"
      ? json(201, { id: CONV, status: "open", messages: [], handoff: null, ...body })
      : undefined;

const escalation = (over: Record<string, unknown> = {}) =>
  answer({
    id: "esc1",
    content: "I will pass this to the team.",
    citations: [],
    decision: { type: "escalate", confidence: null, reason: "user_requested", citations: [], account_facts: [] },
    ...over,
  });

const revokeRoute: Route = (url, req) =>
  url === "/v1/widget/sessions/current" && req.method === "DELETE" ? new Response(null, { status: 204 }) : undefined;

describe("frame app, anonymous", () => {
  it("opening shows the greeting and creates nothing; the first message creates the session and conversation", async () => {
    const h = start([
      sessionRoute(() => session("st_1")),
      conversationRoute(),
      (url) =>
        url === `/v1/widget/conversations/${CONV}/messages`
          ? sse([
              ["status", { stage: "searching" }],
              ["status", { stage: "writing" }],
              ["message", answer()],
            ])
          : undefined,
      revokeRoute,
    ]);

    h.send({ type: "open" });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.calls).toHaveLength(0);
    expect($(".name")?.textContent).toBe("Lumen Notes");
    expect(texts(".greeting")).toEqual(["Hi, ask me anything about Lumen Notes."]);

    type("How long do refunds take?");
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    expect(h.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /v1/widget/sessions",
      "POST /v1/widget/conversations",
      `POST /v1/widget/conversations/${CONV}/messages`,
    ]);
    // No visitor id yet; the returned one is kept in the frame's own storage.
    expect(h.calls[0].body).toEqual({ widget: WID, parent_origin: HOST });
    expect(h.calls[1]).toMatchObject({ auth: "Bearer st_1", body: {} });
    expect(h.storage.get(`docent:visitor:${WID}`)).toBe(VISITOR);
    expect(h.storage.get(`docent:conversation:${WID}`)).toBe(CONV);

    expect(texts(".msg.visitor .plain")).toEqual(["How long do refunds take?"]);
    const reply = $(".msg.agent:not(.greeting)");
    expect(reply?.querySelector("strong")?.textContent).toBe("5 days");
    expect(reply?.querySelector("button.ref")?.textContent).toBe("1");
    expect(reply?.querySelector(".from-account")).toBeNull();
    const chip = reply?.querySelector<HTMLButtonElement>(".chip");
    expect(chip?.textContent).toContain("Billing and refunds > Refunds");
    chip?.click();
    expect(chip?.getAttribute("aria-expanded")).toBe("true");
    expect(reply?.querySelector(".detail a")?.getAttribute("href")).toBe("https://help.example.com/refunds");
    await vi.waitFor(() => expect($(".status")?.textContent).toBe(""));
    expect($<HTMLTextAreaElement>("textarea")?.value).toBe("");

    // Reset: revoke on the server, clear storage, then tell the loader.
    h.send({ type: "reset", mode: "anonymous" });
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "reset_done" }));
    expect(h.calls.find((c) => c.method === "DELETE")).toMatchObject({
      url: "/v1/widget/sessions/current",
      auth: "Bearer st_1",
    });
    expect(h.storage.get(`docent:visitor:${WID}`)).toBeNull();
    expect(h.storage.get(`docent:conversation:${WID}`)).toBeNull();
    expect($(".msg.agent:not(.greeting)")).toBeNull();
  });

  it("reset with no session answers reset_done at once", async () => {
    const h = start([]);
    h.send({ type: "reset", mode: "anonymous" });
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "reset_done" }));
    expect(h.calls).toHaveLength(0);
  });

  it("resumes on open: sends the stored visitor id and resume id", async () => {
    // A previous page in this tab left these in the frame's sessionStorage.
    const h = start(
      [sessionRoute(() => session("st_2")), conversationRoute({ messages: [{ ...answer(), id: "old" }] })],
      { mode: "anonymous" },
      config(),
      { [`docent:visitor:${WID}`]: VISITOR, [`docent:conversation:${WID}`]: CONV },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    const sessions = h.calls.filter((c) => c.url === "/v1/widget/sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].body).toEqual({ widget: WID, parent_origin: HOST, visitor_id: VISITOR });
    expect(h.calls.find((c) => c.url === "/v1/widget/conversations")?.body).toEqual({ resume_id: CONV, create: false });
  });

  it("escalation: asks for an email and posts it to contact", async () => {
    const h = start([
      sessionRoute(() => session("st_3")),
      conversationRoute(),
      (url) => (url.endsWith("/messages") ? sse([["message", escalation()]]) : undefined),
      (url) => (url.endsWith("/contact") ? new Response(null, { status: 204 }) : undefined),
    ]);
    h.send({ type: "open" });
    type("I want to talk to a human");
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

  it("resume: no contact form when the handoff already has an email", async () => {
    const h = start(
      [
        sessionRoute(() => session("st_6")),
        conversationRoute({ status: "escalated", messages: [escalation()], handoff: { status: "open", contact_given: true } }),
      ],
      { mode: "anonymous" },
      config(),
      { [`docent:conversation:${WID}`]: CONV },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect($(".note")).not.toBeNull());
    expect($("form.contact")).toBeNull();
  });

  it("resume: shows the contact form under an open handoff without an email", async () => {
    const h = start(
      [
        sessionRoute(() => session("st_7")),
        conversationRoute({
          status: "escalated",
          messages: [escalation({ id: "e-old" }), answer({ id: "a-mid" }), escalation({ id: "e-new" })],
          handoff: { status: "waiting", contact_given: false },
        }),
      ],
      { mode: "anonymous" },
      config(),
      { [`docent:conversation:${WID}`]: CONV },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect($("form.contact")).not.toBeNull());
    expect(document.querySelectorAll("form.contact")).toHaveLength(1);
    expect($('li[data-id="e-new"] form.contact')).not.toBeNull();
  });

  it("resume: a resolved handoff asks for nothing", async () => {
    const h = start(
      [
        sessionRoute(() => session("st_8")),
        conversationRoute({ messages: [escalation()], handoff: { status: "resolved", contact_given: false } }),
      ],
      { mode: "anonymous" },
      config(),
      { [`docent:conversation:${WID}`]: CONV },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect($(".note")).not.toBeNull());
    expect($("form.contact")).toBeNull();
  });

  it("counts unread replies while closed", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const h = start([
      sessionRoute(() => session("st_4")),
      conversationRoute(),
      async (url) => (url.endsWith("/messages") ? (await gate, sse([["message", answer()]])) : undefined),
    ]);
    h.send({ type: "open" });
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
      conversationRoute(),
      (url) =>
        url.endsWith("/messages")
          ? json(429, { error: { code: "rate_limited", message: "Too many" } }, { "retry-after": "600" })
          : undefined,
    ]);
    h.send({ type: "open" });
    type("One more question");
    await vi.waitFor(() => expect($(".notice")?.textContent).toContain("Try again in 10 minutes."));
    expect($<HTMLTextAreaElement>("textarea")?.value).toBe("One more question");
    expect($(".msg.visitor")).toBeNull();
  });

  it("session_expired: creates a new session and retries the call once", async () => {
    let conversations = 0;
    const h = start(
      [
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
            : json(201, { id: CONV, status: "open", messages: [], handoff: null });
        },
      ],
      { mode: "anonymous" },
      config(),
      { [`docent:conversation:${WID}`]: CONV },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.app().conversationId()).toBe(CONV));
    expect(conversations).toBe(2);
    expect(h.calls.filter((c) => c.url === "/v1/widget/sessions")).toHaveLength(2);
  });

  it("open with a stale stored id: 404 no_conversation means no history; the first message creates one", async () => {
    const h = start(
      [
        sessionRoute(() => session("st_9")),
        (url, req) => {
          if (url !== "/v1/widget/conversations") return undefined;
          const body = JSON.parse(String(req.body));
          return body.create === false
            ? json(404, { error: { code: "no_conversation", message: "There is no conversation to resume." } })
            : json(201, { id: CONV, status: "open", messages: [], handoff: null });
        },
        (url) => (url.endsWith("/messages") ? sse([["message", answer()]]) : undefined),
      ],
      { mode: "anonymous" },
      config(),
      { [`docent:conversation:${WID}`]: "11111111-2222-4333-8444-555555555555" },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect(h.storage.get(`docent:conversation:${WID}`)).toBeNull());
    expect(h.calls.map((c) => c.body)).toContainEqual({ resume_id: "11111111-2222-4333-8444-555555555555", create: false });
    // No error state, no status line: just the greeting and a usable composer.
    expect($(".state-title")).toBeNull();
    expect($(".status")?.textContent).toBe("");
    expect($<HTMLFormElement>("form.composer")?.hidden).toBe(false);

    type("Hello");
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    const conversations = h.calls.filter((c) => c.url === "/v1/widget/conversations");
    expect(conversations.map((c) => c.body)).toEqual([
      { resume_id: "11111111-2222-4333-8444-555555555555", create: false },
      {},
    ]);
    expect(h.storage.get(`docent:conversation:${WID}`)).toBe(CONV);
    expect(texts(".msg.visitor .plain")).toEqual(["Hello"]);
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

  it("open with no history: create=false gets 404, then the first message creates the conversation", async () => {
    const created: unknown[] = [];
    const h = start(
      [
        sessionRoute(() => session("st_id2", { mode: "identified", visitor_id: null, user: { name: "Ben Carter" } })),
        (url, req) => {
          if (url !== "/v1/widget/conversations") return undefined;
          const body = JSON.parse(String(req.body));
          created.push(body);
          return body.create === false
            ? json(404, { error: { code: "no_conversation", message: "There is no conversation to resume." } })
            : json(201, { id: CONV, status: "open", messages: [], handoff: null });
        },
        (url) => (url.endsWith("/messages") ? sse([["message", answer()]]) : undefined),
      ],
      { mode: "identified", token: "jwt-1" },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect(created).toEqual([{ create: false }]));
    await vi.waitFor(() => expect($(".status")?.textContent).toBe(""));
    expect($(".state-title")).toBeNull();
    expect(h.app().conversationId()).toBeNull();

    type("How do refunds work?");
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    expect(created).toEqual([{ create: false }, {}]);
    expect(h.app().conversationId()).toBe(CONV);
  });

  it("a message sent while the history lookup is still running waits for it, then creates", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const created: unknown[] = [];
    const h = start(
      [
        sessionRoute(() => session("st_id3", { mode: "identified", visitor_id: null, user: { name: "Ben Carter" } })),
        async (url, req) => {
          if (url !== "/v1/widget/conversations") return undefined;
          const body = JSON.parse(String(req.body));
          created.push(body);
          if (body.create === false) {
            await gate;
            return json(404, { error: { code: "no_conversation", message: "None." } });
          }
          return json(201, { id: CONV, status: "open", messages: [], handoff: null });
        },
        (url) => (url.endsWith("/messages") ? sse([["message", answer()]]) : undefined),
      ],
      { mode: "identified", token: "jwt-1" },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect(created).toEqual([{ create: false }]));
    type("Quick question");
    await new Promise((r) => setTimeout(r, 20));
    expect(created).toEqual([{ create: false }]);
    release();
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    expect(created).toEqual([{ create: false }, {}]);
    expect(texts(".msg.visitor .plain")).toEqual(["Quick question"]);
  });

  it("open loads the visitor's history; account answers are marked; handoffs ask for no email", async () => {
    const identified = () => session("st_ben", { mode: "identified", visitor_id: null, user: { name: "Ben Carter" } });
    const plan = answer({
      id: "a-plan",
      content: "You are on the Free plan.",
      citations: [],
      decision: { type: "answer", confidence: "high", reason: null, citations: [], account_facts: ["plan"] },
    });
    const h = start(
      [
        sessionRoute(identified),
        conversationRoute({ messages: [{ ...answer(), id: "a-old" }] }),
        (url, req) =>
          url.endsWith("/messages")
            ? sse([["message", String(req.body).includes("human") ? escalation() : plan]])
            : undefined,
      ],
      { mode: "identified", token: "jwt-1" },
    );
    // Warm session at init, before any open.
    await vi.waitFor(() => expect(h.calls.map((c) => c.url)).toEqual(["/v1/widget/sessions"]));
    h.send({ type: "open" });
    await vi.waitFor(() => expect($('li[data-id="a-old"]')).not.toBeNull());
    expect(h.calls.find((c) => c.url === "/v1/widget/conversations")?.body).toEqual({ create: false });

    type("What plan am I on?");
    await vi.waitFor(() => expect($('li[data-id="a-plan"] .from-account')?.textContent).toBe("From your account"));
    // Answers with sources are not marked.
    expect($('li[data-id="a-old"] .from-account')).toBeNull();

    type("Can I talk to a human?");
    await vi.waitFor(() => expect($('li[data-id="esc1"] .note')).not.toBeNull());
    expect($('li[data-id="esc1"] .note')?.textContent).toBe("A person from the team will follow up by email.");
    expect($("form.contact")).toBeNull();
  });
});

describe("frame app, panel controls", () => {
  const withSuggestions = config({ suggestions: ["How long do refunds take?", "Can I pay yearly?"] });
  const suggestionTexts = () => texts(".suggest:not([hidden]) .suggestion");

  it("suggestions: under the greeting until the first message; a click sends one", async () => {
    const h = start(
      [
        sessionRoute(() => session("st_s1")),
        conversationRoute(),
        (url) => (url.endsWith("/messages") ? sse([["message", answer()]]) : undefined),
      ],
      { mode: "anonymous" },
      withSuggestions,
    );
    h.send({ type: "open" });
    expect(suggestionTexts()).toEqual(["How long do refunds take?", "Can I pay yearly?"]);
    $<HTMLButtonElement>(".suggestion")?.click();
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    expect(texts(".msg.visitor .plain")).toEqual(["How long do refunds take?"]);
    expect(h.calls.find((c) => c.url.endsWith("/messages"))?.body).toEqual({ content: "How long do refunds take?" });
    expect(suggestionTexts()).toEqual([]);
  });

  it("New chat: asks first, then shows the greeting and suggestions, and the next message starts a new conversation", async () => {
    const created: unknown[] = [];
    const h = start(
      [
        sessionRoute(() => session("st_s2")),
        (url, req) => {
          if (url !== "/v1/widget/conversations") return undefined;
          created.push(JSON.parse(String(req.body)));
          return json(201, { id: CONV, status: "open", messages: [], handoff: null });
        },
        (url) => (url.endsWith("/messages") ? sse([["message", answer()]]) : undefined),
      ],
      { mode: "anonymous" },
      withSuggestions,
    );
    h.send({ type: "open" });
    type("First question");
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    expect(h.storage.get(`docent:conversation:${WID}`)).toBe(CONV);

    const newChat = $<HTMLButtonElement>('button[aria-label="New chat"]');
    newChat?.click();
    const confirm = $(".confirm");
    expect(confirm?.hidden).toBe(false);
    expect(confirm?.textContent).toContain("You will not be able to come back to this one.");
    // Escape cancels the question, not the whole chat.
    confirm?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(confirm?.hidden).toBe(true);
    expect(h.fromFrame).not.toContainEqual({ type: "close" });
    expect(texts(".msg.visitor .plain")).toEqual(["First question"]);

    newChat?.click();
    [...document.querySelectorAll<HTMLButtonElement>(".confirm button")].find((b) => b.textContent === "Start new chat")?.click();
    expect($(".msg.visitor")).toBeNull();
    expect(suggestionTexts()).toHaveLength(2);
    expect(h.app().conversationId()).toBeNull();
    expect(h.storage.get(`docent:conversation:${WID}`)).toBeNull();

    type("Second question");
    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(created).toEqual([{}, { new: true }]);
  });

  it("prefill: fills the message field and sends nothing; layout hides Expand on phones", async () => {
    const h = start([], { mode: "anonymous" }, withSuggestions);
    const expand = $<HTMLButtonElement>('button[aria-label="Expand chat"]');
    expect(expand?.hidden).toBe(true);
    h.send({ type: "layout", compact: false });
    await vi.waitFor(() => expect(expand?.hidden).toBe(false));
    expand?.click();
    expect(expand?.getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "expand", expanded: true }));
    expect(h.storage.get(`docent:expanded:${WID}`)).toBe("1");
    h.send({ type: "layout", compact: true });
    await vi.waitFor(() => expect(expand?.hidden).toBe(true));

    h.send({ type: "open" });
    h.send({ type: "prefill", text: "  How do I export a note?  " });
    await vi.waitFor(() => expect($<HTMLTextAreaElement>("textarea")?.value).toBe("How do I export a note?"));
    h.send({ type: "prefill", text: "x".repeat(1001) });
    h.send({ type: "prefill", text: 42 });
    await new Promise((r) => setTimeout(r, 20));
    expect($<HTMLTextAreaElement>("textarea")?.value).toBe("How do I export a note?");
    expect($<HTMLButtonElement>("button.send")?.disabled).toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it("starts expanded when this tab chose it earlier", async () => {
    const h = start([], { mode: "anonymous" }, config(), { [`docent:expanded:${WID}`]: "1" });
    await vi.waitFor(() => expect(h.fromFrame).toContainEqual({ type: "expand", expanded: true }));
    expect($('button[aria-label="Expand chat"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("a conversation the team closed is never continued: the message starts a new one", async () => {
    const created: unknown[] = [];
    const sent: string[] = [];
    const NEW = "8c1d8b4f-2222-4333-8444-a55566667777";
    const h = start(
      [
        sessionRoute(() => session("st_s3")),
        (url, req) => {
          if (url !== "/v1/widget/conversations") return undefined;
          const body = JSON.parse(String(req.body));
          created.push(body);
          const id = body.new ? NEW : CONV;
          return json(201, { id, status: "open", messages: body.new ? [] : [{ ...answer(), id: "old" }], handoff: null });
        },
        (url) => {
          if (!url.endsWith("/messages")) return undefined;
          sent.push(url);
          return url.includes(CONV)
            ? json(409, { error: { code: "conversation_closed", message: "This conversation is closed." } })
            : sse([["message", answer({ id: "a-new" })]]);
        },
      ],
      { mode: "anonymous" },
      config(),
      { [`docent:conversation:${WID}`]: CONV },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect($('li[data-id="old"]')).not.toBeNull());
    type("Is anyone there?");
    await vi.waitFor(() => expect($('li[data-id="a-new"]')).not.toBeNull());
    expect(created).toEqual([{ resume_id: CONV, create: false }, { new: true }]);
    expect(sent).toEqual([`/v1/widget/conversations/${CONV}/messages`, `/v1/widget/conversations/${NEW}/messages`]);
    // The old thread is gone from view; the new one holds the message.
    expect($('li[data-id="old"]')).toBeNull();
    expect(texts(".msg.visitor .plain")).toEqual(["Is anyone there?"]);
    expect(h.app().conversationId()).toBe(NEW);
  });
});

describe("frame app, recent chats", () => {
  const OLD = "6a0b9c8d-3333-4444-8555-b66677778888";
  const identified = () => session("st_r", { mode: "identified", visitor_id: null, user: { name: "Ben Carter" } });
  const summaries = [
    { id: CONV, status: "open", title: "How long do refunds take?", started_at: new Date().toISOString(), last_message_at: new Date().toISOString() },
    { id: OLD, status: "closed", title: "Where is my invoice?", started_at: "2025-01-02T10:00:00Z", last_message_at: "2025-01-02T10:05:00Z" },
  ];

  it("lists the customer's chats, opens one, and shows a closed one read only", async () => {
    const h = start(
      [
        sessionRoute(identified),
        (url, req) => (url === "/v1/widget/conversations" && req.method === "GET" ? json(200, summaries) : undefined),
        conversationRoute({ messages: [{ ...answer(), id: "a-current" }] }),
        (url, req) =>
          url === `/v1/widget/conversations/${OLD}` && req.method === "GET"
            ? json(200, { id: OLD, status: "closed", messages: [{ ...answer(), id: "a-old" }], handoff: null })
            : undefined,
      ],
      { mode: "identified", token: "jwt-1" },
    );
    const recent = $<HTMLButtonElement>('button[aria-label="Recent chats"]');
    expect(recent?.hidden).toBe(false);
    h.send({ type: "open" });
    await vi.waitFor(() => expect($('li[data-id="a-current"]')).not.toBeNull());

    recent?.click();
    await vi.waitFor(() => expect(texts(".history-q")).toEqual(["How long do refunds take?", "Where is my invoice?"]));
    expect(recent?.getAttribute("aria-pressed")).toBe("true");
    expect($<HTMLElement>(".log")?.hidden).toBe(true);
    const metas = texts(".history-meta");
    expect(metas[0]).toBe("Today · Open · Current");
    expect(metas[1]).toMatch(/· Closed$/);
    expect($(`.history-item[data-id="${CONV}"]`)?.getAttribute("aria-current")).toBe("true");

    $<HTMLButtonElement>(`.history-item[data-id="${OLD}"]`)?.click();
    await vi.waitFor(() => expect($('li[data-id="a-old"]')).not.toBeNull());
    expect(h.app().conversationId()).toBe(OLD);
    expect($<HTMLElement>(".history")?.hidden).toBe(true);
    expect($<HTMLFormElement>("form.composer")?.hidden).toBe(true);
    expect($<HTMLElement>(".closed")?.hidden).toBe(false);
    expect($(".closed")?.textContent).toContain("This chat is closed.");

    // Start a new chat from there: no question asked, the composer comes back.
    $<HTMLButtonElement>(".closed button")?.click();
    expect($<HTMLFormElement>("form.composer")?.hidden).toBe(false);
    expect(h.app().conversationId()).toBeNull();
    expect(h.storage.get(`docent:new:${WID}`)).toBe("1");
  });

  it("anonymous visitors have no Recent chats button", () => {
    start([]);
    expect($<HTMLButtonElement>('button[aria-label="Recent chats"]')?.hidden).toBe(true);
  });
});

describe("frame app, was this helpful", () => {
  const FEEDBACK = `/v1/widget/conversations/${CONV}/messages/a1/feedback`;
  const voteRoute =
    (status = 200): Route =>
    (url, req) => {
      if (url !== FEEDBACK) return undefined;
      if (req.method === "DELETE") return new Response(null, { status: 204 });
      return status === 200
        ? json(200, { comment: "", ...JSON.parse(String(req.body)), updated_at: new Date().toISOString() })
        : json(status, { error: { code: "rate_limited", message: "Slow down." } }, { "retry-after": "120" });
    };
  const pressed = () => document.querySelectorAll('.rate-btn[aria-pressed="true"]').length;
  const thumb = (label: "Helpful" | "Not helpful") => $<HTMLButtonElement>(`.rate-btn[aria-label="${label}"]`);
  const votes = (h: Harness) => h.calls.filter((c) => c.url === FEEDBACK).map((c) => [c.method, c.body]);
  const messages = (reply: unknown): Route => (url) =>
    url === `/v1/widget/conversations/${CONV}/messages` ? sse([["message", reply]]) : undefined;

  async function answered(routes: Route[], reply: unknown = answer()): Promise<Harness> {
    const h = start([sessionRoute(() => session("st_v")), conversationRoute(), messages(reply), ...routes]);
    h.send({ type: "open" });
    type("How long do refunds take?");
    await vi.waitFor(() => expect($(".msg.agent:not(.greeting)")).not.toBeNull());
    return h;
  }

  it("only answers get thumbs: not greetings, clarifying questions, or handoffs", async () => {
    await answered([], escalation());
    expect($(".rate")).toBeNull();
    const clarify = answer({
      id: "c1",
      citations: [],
      decision: { type: "clarify", confidence: null, reason: null, citations: [], account_facts: [] },
    });
    await answered([], clarify);
    expect($(".rate")).toBeNull();
    expect($(".greeting .rate")).toBeNull();
  });

  it("a thumbs up says thanks; pressing it again takes the vote back", async () => {
    const h = await answered([voteRoute()]);
    const group = $(".rate");
    expect(group?.getAttribute("role")).toBe("group");
    expect(document.getElementById(group?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Was this helpful?");
    expect(thumb("Helpful")?.getAttribute("aria-pressed")).toBe("false");
    thumb("Helpful")?.click();
    expect(thumb("Helpful")?.getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(() => expect($(".rate-said")?.textContent).toBe("Thanks for letting us know."));
    expect($("form.rate-more")).toBeNull();
    thumb("Helpful")?.click();
    await vi.waitFor(() => expect(votes(h)).toHaveLength(2));
    expect(votes(h)).toEqual([
      ["PUT", { vote: "up" }],
      ["DELETE", undefined],
    ]);
    expect(pressed()).toBe(0);
  });

  it("a thumbs down asks what was wrong, sends the note, and offers a person", async () => {
    const h = await answered([voteRoute()]);
    thumb("Not helpful")?.click();
    await vi.waitFor(() => expect($("form.rate-more")).not.toBeNull());
    expect(thumb("Not helpful")?.getAttribute("aria-pressed")).toBe("true");
    const note = $<HTMLTextAreaElement>(".rate-text");
    if (!note) throw new Error("no note field");
    expect(note.getAttribute("maxlength")).toBe("500");
    expect(document.activeElement).toBe(note);
    expect($(`label[for="${note.id}"]`)?.textContent).toBe("What was wrong? (optional)");
    note.value = "  It is 14 days for monthly plans. ";
    $<HTMLFormElement>("form.rate-more")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect($(".rate-said")?.textContent).toBe("Thanks. The team will read your note."));
    expect($("form.rate-more")).toBeNull();
    // With the note sent, a person is still one click away.
    expect($(".rate-person")).not.toBeNull();
    expect(votes(h)).toEqual([
      ["PUT", { vote: "down" }],
      ["PUT", { vote: "down", comment: "It is 14 days for monthly plans." }],
    ]);

    // A thumbs up closes all that; down again offers a person, through the normal handoff.
    thumb("Helpful")?.click();
    await vi.waitFor(() => expect(votes(h)).toHaveLength(3));
    expect($("form.rate-more")).toBeNull();
    expect($(".rate-person")).toBeNull();
    thumb("Not helpful")?.click();
    await vi.waitFor(() => expect($(".rate-person")).not.toBeNull());
    $<HTMLButtonElement>(".rate-person")?.click();
    expect(texts(".msg.visitor .plain")).toContain("I would like to talk to a person.");
    const sent = () => h.calls.filter((c) => c.url === `/v1/widget/conversations/${CONV}/messages`).map((c) => c.body);
    await vi.waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1]).toEqual({ content: "I would like to talk to a person." });
    expect($("form.rate-more")).toBeNull();
  });

  it("no offer of a person once the conversation was handed off", async () => {
    await answered([voteRoute()]);
    // The team was already asked: an escalation note is in the conversation.
    const handed = document.createElement("li");
    handed.className = "msg agent";
    handed.appendChild(Object.assign(document.createElement("div"), { className: "note" }));
    $(".list")?.appendChild(handed);
    thumb("Not helpful")?.click();
    await vi.waitFor(() => expect($("form.rate-more")).not.toBeNull());
    expect($(".rate-person")).toBeNull();
  });

  it("a failed vote goes back and says why", async () => {
    await answered([voteRoute(429)]);
    thumb("Helpful")?.click();
    await vi.waitFor(() => expect($(".rate-said")?.textContent).toBe("Too many tries. Try again in 2 minutes."));
    expect(pressed()).toBe(0);
  });

  it("history brings back the visitor's own vote", async () => {
    const h = start(
      [
        sessionRoute(() => session("st_v3")),
        conversationRoute({ messages: [answer({ feedback: { vote: "down", comment: "Wrong plan." } })] }),
      ],
      { mode: "anonymous" },
      config(),
      { [`docent:visitor:${WID}`]: VISITOR, [`docent:conversation:${WID}`]: CONV },
    );
    h.send({ type: "open" });
    await vi.waitFor(() => expect($(".rate")).not.toBeNull());
    expect(thumb("Not helpful")?.getAttribute("aria-pressed")).toBe("true");
    expect(thumb("Helpful")?.getAttribute("aria-pressed")).toBe("false");
    expect($(".rate-said")?.textContent).toBe("Thanks for letting us know.");
    expect($("form.rate-more")).toBeNull();
  });
});
