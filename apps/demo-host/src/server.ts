// Docent's live showcase: two fictional companies with the widget installed.
//
//   /lumen-notes   a notes app's public site and help center. Anonymous chat for everyone.
//   /parcelwise    a shipping dashboard. Its own sign-in (a signed cookie) and a
//                  /parcelwise/docent-token endpoint that signs an identity token
//                  for whoever is signed in, which is exactly what a real customer
//                  adds to their server. No chat until you sign in.
//
// It listens on two ports: the first origin is on the widgets' allowed lists,
// the second is not, so the browser refuses to show the chat there.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { importJWK, SignJWT } from "jose";

import { articlePage, helpPage, homePage } from "./lumen.ts";
import { dashboardPage, signInPage, TOKEN_PATH } from "./parcelwise.ts";
import { indexPage, type Context, type Install } from "./shell.ts";
import { findPersona, LUMEN, PARCELWISE, type Persona, type Site } from "./sites.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 5173);
const OTHER_PORT = Number(process.env.OTHER_PORT ?? 5174);
const DOCENT_URL = process.env.DOCENT_URL || "http://localhost:3000";
const KEYS_DIR =
  process.env.DEMO_KEYS_DIR ?? fileURLToPath(new URL("../../../.data/demo-host/", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const COOKIE = "parcelwise_session";
/**
 * Many visitors share each demo customer. A random id per browser, kept across
 * sign-outs, goes into the token's `sub`, so a visitor resumes only their own
 * chat and never sees someone else's. A real site would use its own user id.
 */
const DEVICE_COOKIE = "parcelwise_device";
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;
const COOKIE_PATH = `/${PARCELWISE.slug}`;
const COOKIE_SECRET = randomBytes(32);
const TOKEN_LIFETIME = "5m";

const ASSETS: Record<string, string> = {
  "showcase.css": "text/css; charset=utf-8",
  "lumen.css": "text/css; charset=utf-8",
  "parcelwise.css": "text/css; charset=utf-8",
  "showcase.js": "text/javascript; charset=utf-8",
  "lumen-icon.svg": "image/svg+xml",
  "parcelwise-icon.svg": "image/svg+xml",
  "docent-icon.svg": "image/svg+xml",
};

const origin = (port: number) => `http://localhost:${port}`;

async function readInstall(site: Site): Promise<Install | null> {
  try {
    return JSON.parse(await readFile(join(KEYS_DIR, `${site.slug}.json`), "utf8")) as Install;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sign(value: string): string {
  return createHmac("sha256", COOKIE_SECRET).update(value).digest("base64url");
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  return req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** The Parcelwise customer this site's own sign-in says is here, if any. */
function signedIn(req: IncomingMessage): Persona | undefined {
  const [value, mac] = cookie(req, COOKIE)?.split(".") ?? [];
  if (!value || !mac) return undefined;
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  return findPersona(value);
}

async function identityToken(install: Install, persona: Persona, device: string): Promise<string> {
  const key = await importJWK(install.private_jwk, "ES256");
  return new SignJWT({ name: persona.name, email: persona.email, ctx: persona.context })
    .setProtectedHeader({ alg: "ES256", kid: install.kid })
    .setIssuer(install.widget)
    .setAudience("docent")
    .setSubject(`${persona.id}-${device}`)
    .setIssuedAt()
    .setExpirationTime(TOKEN_LIFETIME)
    .setJti(randomUUID())
    .sign(key);
}

async function formBody(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024) throw new Error("Form too large");
  }
  return new URLSearchParams(body);
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  res.end(body);
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  res.writeHead(303, { location, ...(cookies.length ? { "set-cookie": cookies } : {}) });
  res.end();
}

const sessionCookie = (value: string, maxAge?: number) =>
  `${COOKIE}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}`;
const deviceCookie = (value: string) =>
  `${DEVICE_COOKIE}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;

const notFound = (ctx: Context) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title><link rel="stylesheet" href="/assets/showcase.css"></head><body class="ix-body"><main id="main" class="ix"><h1>Page not found</h1><p class="ix-lead">This showcase has two sites: <a href="/${LUMEN.slug}">Lumen Notes</a> and <a href="/${PARCELWISE.slug}">Parcelwise</a>. <a href="${ctx.docentUrl}">About Docent</a>.</p></main></body></html>`;

async function handle(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  const url = new URL(req.url ?? "/", origin(port));
  const path = url.pathname.replace(/(.)\/$/, "$1");
  const ctx: Context = {
    allowed: port === PORT,
    allowedOrigin: origin(PORT),
    otherOrigin: origin(OTHER_PORT),
    docentUrl: DOCENT_URL,
  };
  const html = (body: string, status = 200) => send(res, status, body, "text/html; charset=utf-8");

  if (req.method === "POST") {
    // Forms post only from the page's own origin (localhost or 127.0.0.1, on this port).
    if (!req.headers.origin || req.headers.origin !== `http://${req.headers.host}`) {
      return send(res, 403, "Forbidden", "text/plain");
    }
    if (path === `${COOKIE_PATH}/sign-out`) return redirect(res, COOKIE_PATH, [sessionCookie("", 0)]);
    if (path === `${COOKIE_PATH}/sign-in`) {
      const persona = findPersona((await formBody(req)).get("persona") ?? "");
      if (!persona) return send(res, 400, "Unknown customer", "text/plain");
      const device = cookie(req, DEVICE_COOKIE);
      return redirect(res, COOKIE_PATH, [
        sessionCookie(`${persona.id}.${sign(persona.id)}`),
        deviceCookie(device && DEVICE_ID.test(device) ? device : randomBytes(16).toString("base64url")),
      ]);
    }
    return send(res, 405, "Method not allowed", "text/plain");
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");

  if (path.startsWith("/assets/")) {
    const name = path.slice("/assets/".length);
    const type = ASSETS[name];
    if (!type) return html(notFound(ctx), 404);
    return send(res, 200, await readFile(join(PUBLIC_DIR, name), "utf8"), type);
  }

  if (path === "/") return html(indexPage(ctx));

  if (path === `/${LUMEN.slug}`) return html(await homePage(ctx, await readInstall(LUMEN)));
  if (path === `/${LUMEN.slug}/help`) {
    return html(await helpPage(ctx, await readInstall(LUMEN), url.searchParams.get("q") ?? ""));
  }
  const article = new RegExp(`^/${LUMEN.slug}/help/([a-z0-9-]+)$`).exec(path);
  if (article) {
    const page = await articlePage(ctx, await readInstall(LUMEN), article[1] ?? "");
    return page ? html(page) : html(notFound(ctx), 404);
  }

  if (path === COOKIE_PATH) {
    const persona = signedIn(req);
    return html(persona ? dashboardPage(ctx, await readInstall(PARCELWISE), persona) : signInPage(ctx));
  }
  if (path === TOKEN_PATH) {
    const persona = signedIn(req);
    const device = cookie(req, DEVICE_COOKIE);
    const install = persona && (await readInstall(PARCELWISE));
    if (!persona || !install || !device || !DEVICE_ID.test(device)) {
      return send(res, 401, "Not signed in", "text/plain");
    }
    return send(res, 200, await identityToken(install, persona, device), "text/plain");
  }

  return html(notFound(ctx), 404);
}

for (const port of [PORT, OTHER_PORT]) {
  createServer((req, res) => {
    handle(req, res, port).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) send(res, 500, "Something went wrong", "text/plain");
    });
  }).listen(port, HOST, () => {
    console.log(`Showcase on ${origin(port)} (${port === PORT ? "allowed" : "not allowed"} origin)`);
  });
}
