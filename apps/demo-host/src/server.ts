// A pretend customer website for trying the Docent widget end to end.
//
// It has its own sign-in (a signed cookie) and a /docent-token endpoint that
// signs an identity token for whoever that cookie says is signed in, which is
// exactly what a real customer adds to their server. It listens on two ports:
// the first origin is on the widget's allowed list, the second is not.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { importJWK, SignJWT } from "jose";

import { page, type Install } from "./page.ts";
import { findSite, SITES, type Persona, type Site } from "./sites.ts";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 5173);
const OTHER_PORT = Number(process.env.OTHER_PORT ?? 5174);
const KEYS_DIR =
  process.env.DEMO_KEYS_DIR ?? fileURLToPath(new URL("../../../.data/demo-host/", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const COOKIE = "demo_session";
const COOKIE_SECRET = randomBytes(32);
const TOKEN_LIFETIME = "5m";
const ASSETS: Record<string, string> = {
  "/assets/host.css": "text/css; charset=utf-8",
  "/assets/host.js": "text/javascript; charset=utf-8",
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

/** The visitor this site's own login says is signed in, if any. */
function visitorOf(req: IncomingMessage): { site: Site; persona: Persona } | undefined {
  const raw = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const [value, mac] = raw?.split(".") ?? [];
  if (!value || !mac) return undefined;
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  const [slug, personaId] = value.split(":");
  const site = findSite(slug ?? "");
  const persona = site?.personas.find((p) => p.id === personaId);
  return site && persona ? { site, persona } : undefined;
}

async function identityToken(install: Install, persona: Persona): Promise<string> {
  const key = await importJWK(install.private_jwk, "ES256");
  return new SignJWT({ name: persona.name, email: persona.email, ctx: persona.context })
    .setProtectedHeader({ alg: "ES256", kid: install.kid })
    .setIssuer(install.widget)
    .setAudience("docent")
    .setSubject(persona.id)
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
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function redirect(res: ServerResponse, location: string, cookie?: string): void {
  res.writeHead(303, { location, ...(cookie ? { "set-cookie": cookie } : {}) });
  res.end();
}

async function handle(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  const { pathname } = new URL(req.url ?? "/", origin(port));
  const allowed = port === PORT;

  if (req.method === "GET" && pathname === "/") return redirect(res, `/${SITES[0]?.slug}`);

  const asset = ASSETS[pathname];
  if (req.method === "GET" && asset) {
    return send(res, 200, await readFile(join(PUBLIC_DIR, pathname.slice(8)), "utf8"), asset);
  }

  if (req.method === "GET" && pathname === "/docent-token") {
    const visitor = visitorOf(req);
    const install = visitor && (await readInstall(visitor.site));
    if (!visitor || !install) return send(res, 401, "Not signed in", "text/plain");
    return send(res, 200, await identityToken(install, visitor.persona), "text/plain");
  }

  const match = /^\/([a-z-]+)(\/sign-in|\/sign-out)?$/.exec(pathname);
  const site = match && findSite(match[1] ?? "");
  if (!site) return send(res, 404, "Not found", "text/plain");

  if (req.method === "POST") {
    // Forms post only from this origin.
    if (req.headers.origin !== origin(port)) return send(res, 403, "Forbidden", "text/plain");
    if (match?.[2] === "/sign-out") {
      return redirect(res, `/${site.slug}`, `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    }
    const personaId = (await formBody(req)).get("persona");
    const persona = site.personas.find((p) => p.id === personaId);
    if (!persona) return send(res, 400, "Unknown person", "text/plain");
    const value = `${site.slug}:${persona.id}`;
    return redirect(res, `/${site.slug}`, `${COOKIE}=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Lax`);
  }

  if (req.method !== "GET" || match?.[2]) return send(res, 405, "Method not allowed", "text/plain");
  const visitor = visitorOf(req);
  const html = page({
    site,
    visitor: visitor?.site === site ? visitor.persona : undefined,
    install: await readInstall(site),
    allowed,
    otherOrigin: origin(OTHER_PORT),
  });
  return send(res, 200, html, "text/html; charset=utf-8");
}

for (const port of [PORT, OTHER_PORT]) {
  createServer((req, res) => {
    handle(req, res, port).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) send(res, 500, "Something went wrong", "text/plain");
    });
  }).listen(port, HOST, () => {
    console.log(`Demo host on ${origin(port)} (${port === PORT ? "allowed" : "not allowed"} origin)`);
  });
}
