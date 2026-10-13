/// <reference types="node" />
// Sets up a fresh tenant for the widget checks, through the API the way a
// customer would: sign up, confirm the email (via Mailpit), teach the agent one
// public article, create a widget for the demo host, and register a signing key.
// The demo host reads the private key from DOCENT_E2E_DIR/lumen-notes.json.
import { generateKeyPairSync } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, MAILPIT, WEB_ORIGIN, fakeClientIp, hosts, type E2EState, statePath } from "./support";

const PASSWORD = "correct horse battery widget";

const ARTICLE = `# Exporting notes

Open a note or notebook and select Export. Choose PDF, Markdown, or HTML.
PDF exports include comments. Markdown exports are a ZIP file with every note
and its attachments.

## Exporting a whole workspace

Owners can export the whole workspace from Settings > Workspace > Export.
`;

/** A tiny cookie-keeping client for the staff API (session cookie plus Origin for CSRF). */
function client() {
  const cookies = new Map<string, string>();
  // Locally the API trusts X-Forwarded-For from 127.0.0.1, so each run gets its
  // own rate limit bucket. Behind Docker (CI) the header is ignored.
  const ip = fakeClientIp();
  return async (method: string, path: string, body?: unknown): Promise<Response> => {
    const headers: Record<string, string> = { origin: WEB_ORIGIN, "x-forwarded-for": ip };
    if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${path}`, { method, headers, body: payload });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return res;
  };
}

async function expectOk(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function waitFor<T>(what: string, timeoutMs: number, check: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== null) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
}

/** The verify-email token from the link Docent mailed to `to`. */
async function verifyToken(to: string): Promise<string> {
  return waitFor(`the verification email to ${to}`, 30_000, async () => {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (!search.ok) throw new Error(`Mailpit search failed: ${search.status}. Is Mailpit running on ${MAILPIT}?`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    for (const m of messages) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text?: string; HTML?: string };
      const match = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(`${full.Text ?? ""}\n${full.HTML ?? ""}`);
      if (match) return match[1];
    }
    return null;
  });
}

export default async function globalSetup(): Promise<() => void> {
  const { host, thirdPartyHost } = hosts();

  // The API must be up and serving a built widget.
  const loader = await fetch(`${API}/widget/v1/loader.js`).catch(() => null);
  if (!loader?.ok) {
    throw new Error(
      `${API}/widget/v1/loader.js is not available (${loader?.status ?? "no response"}). ` +
        "Start the API and build the widget first: pnpm --filter @docent/widget build",
    );
  }

  const api = client();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const email = `widget-e2e-${id}@example.com`;
  await expectOk(
    await api("POST", "/v1/auth/signup", {
      name: "Widget Tester",
      email,
      password: PASSWORD,
      workspace_name: `Lumen Notes ${id}`,
    }),
    "Sign up",
  );
  await expectOk(await api("POST", "/v1/auth/verify-email", { token: await verifyToken(email) }), "Verify email");

  // Teach the agent one public article and wait until it is searchable.
  const form = new FormData();
  form.append("file", new Blob([ARTICLE], { type: "text/markdown" }), "exporting-notes.md");
  form.append("audience", "public");
  const source = (await expectOk(await api("POST", "/v1/knowledge/uploads", form), "Upload")) as { id: string };
  await waitFor("the uploaded article to be ready (is the worker running?)", 120_000, async () => {
    const detail = (await expectOk(await api("GET", `/v1/knowledge/sources/${source.id}`), "Read source")) as {
      source: { status: string; last_error: string | null };
    };
    if (detail.source.status === "failed") throw new Error(`Indexing failed: ${detail.source.last_error}`);
    return detail.source.status === "ready" ? true : null;
  });

  // The widget allows the demo host by name and by IP. The IP origin is a
  // different site from the widget origin, so the browser treats the widget's
  // cookies there as third-party.
  const widget = (await expectOk(
    await api("POST", "/v1/widgets", {
      name: "Help center",
      allowed_origins: [host, thirdPartyHost],
      anonymous_enabled: true,
      anonymous_daily_cap: 200,
      allowed_claims: ["plan", "workspace"],
      greeting: "Hi, ask me anything about Lumen Notes.",
    }),
    "Create widget",
  )) as { id: string; public_id: string; embed_origin: string };

  // The tenant keeps the private key; Docent only ever sees the public half.
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const key = (await expectOk(
    await api("POST", `/v1/widgets/${widget.id}/keys`, { public_jwk: publicKey.export({ format: "jwk" }) }),
    "Add signing key",
  )) as { kid: string };

  const dir = process.env.DOCENT_E2E_DIR as string;
  writeFileSync(
    join(dir, "lumen-notes.json"),
    JSON.stringify({
      company: "Lumen Notes",
      widget: widget.public_id,
      kid: key.kid,
      private_jwk: privateKey.export({ format: "jwk" }),
      widget_origin: widget.embed_origin,
    }),
    { mode: 0o600 },
  );
  const state: E2EState = { widget: widget.public_id, widgetOrigin: widget.embed_origin };
  writeFileSync(statePath(), JSON.stringify(state));

  // Teardown: the folder holds a private key, so do not leave it behind.
  return () => rmSync(dir, { recursive: true, force: true });
}
