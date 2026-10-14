import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi, isNoConversation } from "../src/frame/api";
import type { Stage } from "../src/frame/types";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const sse = (chunks: string[], status = 200) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }),
    { status, headers: { "content-type": "text/event-stream" } },
  );

const MESSAGE = {
  id: "7b0c7a3e-1111-4222-8333-944455556666",
  role: "agent",
  content: "Refunds take 5 days [1].",
  decision: { type: "answer", confidence: "high", reason: null, citations: [1], account_facts: ["plan", 7] },
  citations: [
    { marker: 1, document_title: "Billing", heading_path: "Refunds", url: "https://help.example.com/r", excerpt: "x" },
  ],
  created_at: "2026-10-14T10:00:00Z",
};

function setup(responses: Response[]) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  });
  return { api: createApi("/v1/widget", fetch as unknown as typeof globalThis.fetch), fetch };
}

const headersOf = (init?: RequestInit) => init?.headers as Record<string, string>;

describe("api client", () => {
  it("creates a session without auth, with no cookies, and reads expires_in", async () => {
    const { api, fetch } = setup([
      json(
        201,
        {
          session_token: "st_1",
          expires_at: "2026-10-14T10:30:00Z",
          expires_in: 1800,
          mode: "anonymous",
          visitor_id: "v_abcdefghijklmnopqrstu",
          user: { name: null },
          widget: { name: "Lumen Notes", greeting: "Hi" },
        },
        { date: "Wed, 14 Oct 2026 10:00:00 GMT" },
      ),
    ]);
    const out = await api.createSession({ widget: "wid_abcdefghijklmnop", parent_origin: "http://localhost:5173" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/v1/widget/sessions");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(headersOf(init).Authorization).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual({ widget: "wid_abcdefghijklmnop", parent_origin: "http://localhost:5173" });
    expect(out.session.session_token).toBe("st_1");
    expect(out.session.visitor_id).toBe("v_abcdefghijklmnopqrstu");
    expect(out.session.expires_in).toBe(1800);
  });

  it("reads error codes from the API error shape, with Retry-After", async () => {
    const { api } = setup([
      json(401, { error: { code: "token_invalid", message: "The sign-in token was rejected." } }),
      json(429, { error: { code: "rate_limited", message: "Too many attempts." } }, { "retry-after": "120" }),
      new Response("upstream down", { status: 502 }),
      json(403, { detail: { code: "anonymous_disabled", message: "x" } }),
    ]);
    const body = { widget: "wid_abcdefghijklmnop", parent_origin: "http://localhost:5173" };
    await expect(api.createSession(body)).rejects.toMatchObject({ status: 401, code: "token_invalid" });
    await expect(api.createSession(body)).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfter: 120 });
    await expect(api.createSession(body)).rejects.toMatchObject({ status: 502, code: "http_502" });
    await expect(api.createSession(body)).rejects.toMatchObject({ status: 403, code: "anonymous_disabled" });
  });

  it("turns a network failure into a network error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const api = createApi("/v1/widget", fetch as unknown as typeof globalThis.fetch);
    await expect(api.revoke("st")).resolves.toBeUndefined();
    await expect(api.createConversation("st")).rejects.toMatchObject({ status: 0, code: "network" });
  });

  it("sends the bearer token and resume_id to conversations", async () => {
    const { api, fetch } = setup([
      json(201, {
        id: "c1",
        status: "escalated",
        messages: [MESSAGE, { junk: true }],
        handoff: { status: "open", contact_given: true },
      }),
      json(201, { id: "c2", status: "open", messages: [], handoff: null }),
      json(404, { error: { code: "no_conversation", message: "There is no conversation to resume." } }),
    ]);
    const conv = await api.createConversation("st_1", "c0");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/v1/widget/conversations");
    expect(headersOf(init).Authorization).toBe("Bearer st_1");
    expect(JSON.parse(String(init?.body))).toEqual({ resume_id: "c0" });
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].citations[0].marker).toBe(1);
    expect(conv.handoff).toEqual({ status: "open", contact_given: true });
    expect((await api.createConversation("st_1")).handoff).toBeNull();
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({});
    // A history lookup sends create=false and gets a typed 404 when there is none.
    const err = await api.createConversation("st_1", "c9", false).catch((e: unknown) => e);
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual({ resume_id: "c9", create: false });
    expect(isNoConversation(err)).toBe(true);
    expect(isNoConversation(new ApiError(404, "not_found", "x"))).toBe(false);
  });

  it("streams a message: status events, then the reply, across split chunks", async () => {
    const body =
      'event: status\ndata: {"stage":"searching"}\n\n' +
      'event: status\ndata: {"stage":"writing"}\n\n' +
      'event: status\ndata: {"stage":"checking"}\n\n' +
      `event: message\ndata: ${JSON.stringify(MESSAGE)}\n\n`;
    const chunks: string[] = [];
    for (let i = 0; i < body.length; i += 13) chunks.push(body.slice(i, i + 13));
    const { api, fetch } = setup([sse(chunks)]);
    const stages: Stage[] = [];
    const reply = await api.sendMessage("st_1", "c 1", "How do refunds work?", (s) => stages.push(s));
    expect(stages).toEqual(["searching", "writing", "checking"]);
    expect(reply.content).toBe(MESSAGE.content);
    expect(reply.decision?.account_facts).toEqual(["plan"]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/v1/widget/conversations/c%201/messages");
    expect(headersOf(init).Accept).toBe("text/event-stream");
    expect(JSON.parse(String(init?.body))).toEqual({ content: "How do refunds work?" });
  });

  it("keeps conversational replies, which carry no citations", async () => {
    const greeting = { ...MESSAGE, decision: { type: "reply", confidence: null, reason: null, citations: [] } };
    const { api } = setup([sse([`event: message\ndata: ${JSON.stringify(greeting)}\n\n`])]);
    const reply = await api.sendMessage("st_1", "c1", "hi", () => {});
    expect(reply.decision?.type).toBe("reply");
  });

  it("raises a stream error from an SSE error event", async () => {
    const { api } = setup([
      sse(['event: status\ndata: {"stage":"searching"}\n\nevent: error\ndata: {"code":"agent_error","message":"No"}\n\n']),
    ]);
    const err = await api.sendMessage("st", "c", "hi", () => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "agent_error", phase: "stream" });
  });

  it("raises a request error when the server refuses before streaming", async () => {
    const { api } = setup([json(429, { error: { code: "anonymous_cap", message: "Chat is busy today." } })]);
    const err = await api.sendMessage("st", "c", "hi", () => undefined).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 429, code: "anonymous_cap", phase: "request" });
  });

  it("raises when the stream ends without a message", async () => {
    const { api } = setup([sse(['event: status\ndata: {"stage":"searching"}\n\n'])]);
    await expect(api.sendMessage("st", "c", "hi", () => undefined)).rejects.toMatchObject({ code: "stream_ended" });
  });

  it("revokes with DELETE and keepalive", async () => {
    const { api, fetch } = setup([new Response(null, { status: 204 })]);
    await api.revoke("st_9");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/v1/widget/sessions/current");
    expect(init?.method).toBe("DELETE");
    expect(init?.keepalive).toBe(true);
    expect(headersOf(init).Authorization).toBe("Bearer st_9");
  });
});
