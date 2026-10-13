#!/usr/bin/env node
// Local harness for the widget, no dependencies. Two origins:
//   widget  http://localhost:8787  serves dist/, the frame page (with the real
//                                   CSP), and a mock /v1/widget API with SSE
//   host    http://localhost:5199  serves dev/host.html, a fake customer site
// Run `pnpm build` first, then `pnpm dev`, then open http://localhost:5199.
//
// Mock answers: mention "human" to get an escalation, "arabic" for an RTL
// reply, "slow" for a long wait, "fail" for an agent error.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const WIDGET_PORT = Number(process.env.WIDGET_PORT ?? 8787);
const HOST_PORT = Number(process.env.HOST_PORT ?? 5199);
const WIDGET = `http://localhost:${WIDGET_PORT}`;
const HOST = `http://localhost:${HOST_PORT}`;
const WIDGET_ID = "wid_devdevdevdevdevde";
const ANONYMOUS = process.env.ANONYMOUS !== "0";

const config = {
  publicId: WIDGET_ID,
  name: "Lumen Notes",
  greeting: "Hi, ask me anything about Lumen Notes.",
  allowedOrigins: [HOST],
  anonymous: ANONYMOUS,
  apiBase: "/v1/widget",
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  `frame-ancestors ${HOST}`,
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");

const frameHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="docent-widget" content="${escapeAttr(JSON.stringify(config))}">
<title>Support chat</title>
<link rel="stylesheet" href="/widget/v1/frame.css"></head><body><div id="docent"></div><script src="/widget/v1/frame.js"></script></body></html>`;

// In-memory state, enough for a demo.
const sessions = new Map(); // token -> { mode, visitor, user }
const conversations = new Map(); // id -> { owner, messages }
let tokenCount = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, body, headers = {}) {
  const isJson = body !== null && typeof body === "object";
  res.writeHead(status, {
    "content-type": isJson ? "application/json" : "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : (body ?? ""));
}

const error = (res, status, code, message, headers) => send(res, status, { error: { code, message } }, headers);

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

function sessionOf(req) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  return scheme === "Bearer" ? sessions.get(token) : undefined;
}

function reply(content, conversationId) {
  const lower = content.toLowerCase();
  const id = randomUUID();
  const created_at = new Date().toISOString();
  if (lower.includes("human")) {
    return {
      id,
      role: "agent",
      content: "I am passing this to the team so a person can help.",
      decision: { type: "escalate", confidence: null, reason: "asked for a human", citations: [] },
      citations: [],
      created_at,
    };
  }
  if (lower.includes("arabic")) {
    return {
      id,
      role: "agent",
      content: "يمكنك استرداد المبلغ خلال **14 يوما** من الشراء [1].",
      decision: { type: "answer", confidence: "high", reason: null, citations: [1] },
      citations: [
        { marker: 1, document_title: "الفوترة", heading_path: "الاسترداد", url: "https://help.example.com/ar/refunds", excerpt: "يتم الاسترداد خلال 14 يوما." },
      ],
      created_at,
    };
  }
  return {
    id,
    role: "agent",
    content:
      `You can get a full refund within **14 days** of purchase [1]. After that, refunds are prorated by the days left in the billing period [2].\n\n` +
      `Start a refund from Settings > Billing, or read https://help.example.com/billing/refunds. <img src=x onerror=alert(1)> stays text. (Conversation ${conversationId.slice(0, 8)}.)`,
    decision: { type: "answer", confidence: "high", reason: null, citations: [1, 2] },
    citations: [
      {
        marker: 1,
        document_title: "Billing and refunds",
        heading_path: "Refunds",
        url: "https://help.example.com/billing/refunds",
        excerpt: "Annual and monthly plans can be refunded in full within 14 days of purchase. Contact support or use Settings > Billing.",
      },
      {
        marker: 2,
        document_title: "Billing and refunds",
        heading_path: "Billing and refunds > Prorated refunds",
        url: null,
        excerpt: "After 14 days, we refund the unused part of the current billing period.",
      },
    ],
    created_at,
  };
}

const widget = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", WIDGET);
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/widget/v1/health") return send(res, 200, { ok: true });
    const asset = /^\/widget\/v1\/(loader\.js|frame\.js|frame\.css)$/.exec(path);
    if (req.method === "GET" && asset) {
      const body = await readFile(join(dist, asset[1]));
      res.writeHead(200, {
        "content-type": asset[1].endsWith(".css") ? "text/css" : "application/javascript",
        "cache-control": "no-store",
        "cross-origin-resource-policy": "cross-origin",
      });
      return res.end(body);
    }
    if (req.method === "GET" && path === `/widget/v1/frame/${WIDGET_ID}`) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "cache-control": "no-store" });
      return res.end(frameHtml);
    }

    if (req.method === "POST" && path === "/v1/widget/sessions") {
      if (req.headers.origin !== WIDGET) return error(res, 403, "origin_not_allowed", "Sessions are created from the widget only.");
      const body = await readJson(req);
      if (!body || body.widget !== WIDGET_ID) return error(res, 404, "widget_not_found", "This widget does not exist.");
      if (!config.allowedOrigins.includes(body.parent_origin)) return error(res, 403, "origin_not_allowed", "Not allowed.");
      if (body.token === "bad") return error(res, 401, "token_invalid", "The sign-in token was rejected.");
      if (!body.token && !ANONYMOUS) return error(res, 403, "anonymous_disabled", "Chat is available after you sign in.");
      const token = `st_${++tokenCount}_${randomUUID().replace(/-/g, "")}`;
      const identified = Boolean(body.token);
      const visitor = identified ? null : body.visitor_id || randomUUID().replace(/-/g, "").slice(0, 32);
      sessions.set(token, { mode: identified ? "identified" : "anonymous", visitor, user: identified ? "sam" : null });
      const minutes = Number(process.env.SESSION_MINUTES ?? 30);
      return send(res, 201, {
        session_token: token,
        expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        mode: identified ? "identified" : "anonymous",
        visitor_id: visitor,
        user: { name: identified ? "Sam Ortiz" : null },
        widget: { name: config.name, greeting: config.greeting },
      });
    }

    const s = sessionOf(req);
    if (path.startsWith("/v1/widget/") && !s) return error(res, 401, "session_expired", "Start the conversation again.");
    const owner = s ? (s.user ?? s.visitor) : null;

    if (req.method === "DELETE" && path === "/v1/widget/sessions/current") {
      sessions.delete(req.headers.authorization.split(" ")[1]);
      res.writeHead(204);
      return res.end();
    }

    if (req.method === "POST" && path === "/v1/widget/conversations") {
      const body = (await readJson(req)) ?? {};
      let id = null;
      for (const [cid, c] of conversations) {
        if (s.mode === "identified" && c.owner === owner) id = cid;
      }
      if (s.mode === "anonymous" && body.resume_id && conversations.get(body.resume_id)?.owner === owner) id = body.resume_id;
      if (!id) {
        id = randomUUID();
        conversations.set(id, { owner, messages: [] });
      }
      return send(res, 201, { id, status: "open", messages: conversations.get(id).messages });
    }

    const msg = /^\/v1\/widget\/conversations\/([^/]+)\/(messages|contact)$/.exec(path);
    if (req.method === "POST" && msg) {
      const conv = conversations.get(msg[1]);
      if (!conv || conv.owner !== owner) return error(res, 404, "not_found", "Conversation not found.");
      const body = await readJson(req);
      if (msg[2] === "contact") {
        if (!body || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email ?? "")) return error(res, 422, "invalid_request", "Some fields need attention.");
        res.writeHead(204);
        return res.end();
      }
      const content = String(body?.content ?? "").trim();
      if (!content || content.length > 2000) return error(res, 422, "invalid_request", "Some fields need attention.");
      if (content.toLowerCase().includes("limit")) return error(res, 429, "rate_limited", "Too many attempts.", { "retry-after": "300" });
      conv.messages.push({ id: randomUUID(), role: "visitor", content, decision: null, citations: [], created_at: new Date().toISOString() });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
      const slow = content.toLowerCase().includes("slow") ? 3 : 1;
      for (const stage of ["searching", "writing", "checking"]) {
        res.write(`event: status\ndata: ${JSON.stringify({ stage })}\n\n`);
        await sleep(500 * slow);
      }
      if (content.toLowerCase().includes("fail")) {
        res.write(`event: error\ndata: ${JSON.stringify({ code: "agent_error", message: "The agent could not reply." })}\n\n`);
        return res.end();
      }
      const answer = reply(content, msg[1]);
      conv.messages.push(answer);
      // Split the final event across writes to exercise the client parser.
      const event = `event: message\ndata: ${JSON.stringify(answer)}\n\n`;
      const mid = Math.floor(event.length / 2);
      res.write(event.slice(0, mid));
      await sleep(50);
      res.end(event.slice(mid));
      return;
    }
    error(res, 404, "not_found", "Not found.");
  } catch (err) {
    console.error(err);
    error(res, 500, "internal_error", "Something went wrong on our side.");
  }
});

let signedIn = 0;
const host = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", HOST);
  if (url.pathname === "/docent-token") {
    // A real tenant signs an ES256 JWT here. Fresh value on every call.
    res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    return res.end(url.searchParams.get("bad") ? "bad" : `dev-token-${++signedIn}`);
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = (await readFile(join(here, "host.html"), "utf8")).replaceAll("__WIDGET_ORIGIN__", WIDGET).replaceAll("__WIDGET_ID__", WIDGET_ID);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(html);
  }
  res.writeHead(404);
  res.end();
});

widget.listen(WIDGET_PORT, () => console.log(`widget origin  ${WIDGET}`));
host.listen(HOST_PORT, () => console.log(`host page      ${HOST}`));
