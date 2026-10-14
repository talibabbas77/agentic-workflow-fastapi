import { describe, expect, it } from "vitest";
import { isTrustedReady, originOf } from "../src/loader/checks";
import { isTrustedInit } from "../src/frame/checks";
import { parentOriginFrom, parseConfig } from "../src/frame/config";

const WIDGET = "http://localhost:8000";
const HOST = "http://localhost:5173";

describe("loader: ready handshake", () => {
  const frameWindow = { name: "frame" };
  const ready = { source: "docent", type: "ready" };

  it("accepts ready from its own iframe on the widget origin", () => {
    expect(isTrustedReady({ origin: WIDGET, source: frameWindow, data: ready }, WIDGET, frameWindow)).toBe(true);
  });

  it("rejects other origins", () => {
    for (const origin of ["http://localhost:8001", "https://localhost:8000", "http://evil.example", "null", ""]) {
      expect(isTrustedReady({ origin, source: frameWindow, data: ready }, WIDGET, frameWindow)).toBe(false);
    }
  });

  it("rejects other sources, even from the right origin", () => {
    const otherFrame = { name: "other" };
    expect(isTrustedReady({ origin: WIDGET, source: otherFrame, data: ready }, WIDGET, frameWindow)).toBe(false);
    expect(isTrustedReady({ origin: WIDGET, source: null, data: ready }, WIDGET, frameWindow)).toBe(false);
    // An iframe that has not loaded yet has no window to match.
    expect(isTrustedReady({ origin: WIDGET, source: null, data: ready }, WIDGET, null)).toBe(false);
  });

  it("rejects messages that are not a docent ready", () => {
    const bad = [null, "ready", { type: "ready" }, { source: "docent", type: "init" }, { source: "other", type: "ready" }];
    for (const data of bad) {
      expect(isTrustedReady({ origin: WIDGET, source: frameWindow, data }, WIDGET, frameWindow)).toBe(false);
    }
  });

  it("works out the widget origin from the script URL", () => {
    expect(originOf("https://widget.docent.example/widget/v1/loader.js?v=1")).toBe("https://widget.docent.example");
    expect(originOf("http://localhost:8000/widget/v1/loader.js")).toBe(WIDGET);
    expect(originOf("")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("data:text/javascript,1")).toBeNull();
  });
});

describe("frame: init message", () => {
  const parent = { name: "parent" };
  const ctx = { parent, parentOrigin: HOST, allowedOrigins: [HOST] };
  const port = { port: true };
  const init = { source: "docent", type: "init", mode: "anonymous" };

  it("accepts init from the parent window on the allowed parent origin, with one port", () => {
    expect(isTrustedInit({ origin: HOST, source: parent, data: init, ports: [port] }, ctx)).toBe(true);
    expect(
      isTrustedInit(
        { origin: HOST, source: parent, data: { ...init, mode: "identified", token: "a.b.c" }, ports: [port] },
        ctx,
      ),
    ).toBe(true);
  });

  it("rejects other origins", () => {
    expect(isTrustedInit({ origin: "http://evil.example", source: parent, data: init, ports: [port] }, ctx)).toBe(false);
    // Allowed origin, but not the one that embeds this frame.
    const two = { ...ctx, allowedOrigins: [HOST, "https://app.example.com"] };
    expect(isTrustedInit({ origin: "https://app.example.com", source: parent, data: init, ports: [port] }, two)).toBe(
      false,
    );
    // Parent origin that is no longer on the allowlist.
    expect(isTrustedInit({ origin: HOST, source: parent, data: init, ports: [port] }, { ...ctx, allowedOrigins: [] })).toBe(
      false,
    );
  });

  it("rejects other sources (a sibling frame, a popup, the frame itself)", () => {
    for (const source of [{ name: "sibling" }, null, undefined]) {
      expect(isTrustedInit({ origin: HOST, source, data: init, ports: [port] }, ctx)).toBe(false);
    }
  });

  it("rejects malformed init messages", () => {
    const cases: unknown[] = [
      { ...init, mode: "admin" },
      { ...init, source: "other" },
      { ...init, type: "ready" },
      { ...init, token: 42 },
      { ...init, token: "x".repeat(20000) },
    ];
    for (const data of cases) {
      expect(isTrustedInit({ origin: HOST, source: parent, data, ports: [port] }, ctx)).toBe(false);
    }
    expect(isTrustedInit({ origin: HOST, source: parent, data: init, ports: [] }, ctx)).toBe(false);
    expect(isTrustedInit({ origin: HOST, source: parent, data: init, ports: [port, port] }, ctx)).toBe(false);
  });
});

describe("frame: parent origin", () => {
  it("prefers ancestorOrigins", () => {
    expect(parentOriginFrom([HOST], "https://other.example/page")).toBe(HOST);
  });

  it("falls back to the referrer origin", () => {
    expect(parentOriginFrom(undefined, "http://localhost:5173/account/settings?x=1")).toBe(HOST);
    expect(parentOriginFrom([], "http://localhost:5173/")).toBe(HOST);
  });

  it("returns null when neither is usable", () => {
    expect(parentOriginFrom(undefined, "")).toBeNull();
    expect(parentOriginFrom(["null"], HOST)).toBeNull();
    expect(parentOriginFrom(undefined, "garbage")).toBeNull();
  });
});

describe("frame: config", () => {
  const good = {
    publicId: "wid_abcdefghijklmnop",
    name: "Lumen Notes",
    greeting: "Hi, ask me anything about Lumen Notes.",
    suggestions: ["How do I export a note?", "Can I get back a deleted note?"],
    allowedOrigins: [HOST],
    anonymous: true,
    apiBase: "/v1/widget",
    siteUrl: "https://docent.example/",
  };

  it("parses the meta config", () => {
    expect(parseConfig(good)).toEqual(good);
  });

  it("keeps up to four distinct, short suggestions", () => {
    const parsed = parseConfig({
      ...good,
      suggestions: ["  One   two? ", "one TWO?", "", 7, "x".repeat(101), "Three?", "Four?", "Five?", "Six?"],
    });
    expect(parsed?.suggestions).toEqual(["One two?", "Three?", "Four?", "Five?"]);
    expect(parseConfig({ ...good, suggestions: "not a list" })?.suggestions).toEqual([]);
  });

  it("links Powered by Docent only to an http(s) site", () => {
    expect(parseConfig({ ...good, siteUrl: "javascript:alert(1)" })?.siteUrl).toBeNull();
    expect(parseConfig({ ...good, siteUrl: undefined })?.siteUrl).toBeNull();
  });

  it("refuses an apiBase that is not a same origin path", () => {
    expect(parseConfig({ ...good, apiBase: "https://evil.example/v1/widget" })).toBeNull();
    expect(parseConfig({ ...good, apiBase: "//evil.example/v1/widget" })).toBeNull();
  });

  it("refuses missing ids or origins", () => {
    expect(parseConfig({ ...good, publicId: "" })).toBeNull();
    expect(parseConfig({ ...good, allowedOrigins: "http://localhost:5173" })).toBeNull();
    expect(parseConfig(null)).toBeNull();
  });
});
