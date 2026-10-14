import { isRecord } from "../shared/protocol";
import { safeUrl } from "./render";
import type { WidgetConfig } from "./types";

export const MAX_SUGGESTIONS = 4;
const SUGGESTION_MAX_LENGTH = 100;

/** Up to four distinct, non-blank questions of at most 100 characters. Anything else is dropped. */
export function parseSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || text.length > SUGGESTION_MAX_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Reads and validates the widget config the API renders into the frame page. */
export function readConfig(doc: Document): WidgetConfig | null {
  const meta = doc.querySelector('meta[name="docent-widget"]');
  const raw = meta?.getAttribute("content");
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseConfig(data);
}

export function parseConfig(data: unknown): WidgetConfig | null {
  if (!isRecord(data)) return null;
  const { publicId, name, greeting, suggestions, allowedOrigins, anonymous, apiBase, siteUrl } = data;
  if (typeof publicId !== "string" || !publicId) return null;
  if (!Array.isArray(allowedOrigins)) return null;
  // API calls must stay same origin: a path like "/v1/widget", never a URL.
  if (typeof apiBase !== "string" || !apiBase.startsWith("/") || apiBase.startsWith("//")) return null;
  return {
    publicId,
    name: typeof name === "string" && name ? name : "Support",
    greeting: typeof greeting === "string" ? greeting : "",
    suggestions: parseSuggestions(suggestions),
    allowedOrigins: allowedOrigins.filter((o): o is string => typeof o === "string" && o !== "" && o !== "null"),
    anonymous: anonymous === true,
    apiBase: apiBase.replace(/\/+$/, ""),
    siteUrl: typeof siteUrl === "string" ? safeUrl(siteUrl) : null,
  };
}

/**
 * The embedding page's origin. location.ancestorOrigins is exact where it
 * exists (Chromium, Safari). Elsewhere fall back to document.referrer, which
 * the loader guarantees by setting referrerpolicy="strict-origin" on the iframe.
 */
export function parentOriginFrom(
  ancestorOrigins: ArrayLike<string> | null | undefined,
  referrer: string,
): string | null {
  const first = ancestorOrigins && ancestorOrigins.length > 0 ? ancestorOrigins[0] : undefined;
  if (first !== undefined) return first && first !== "null" ? first : null;
  if (!referrer) return null;
  try {
    const origin = new URL(referrer).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}
