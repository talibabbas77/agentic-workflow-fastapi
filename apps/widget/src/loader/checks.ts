import { SOURCE, isRecord, type MessageLike } from "../shared/protocol";

/**
 * The loader accepts "ready" only from the iframe it created, served from the
 * widget origin. Anything else on the host page (other frames, extensions,
 * the page itself) is ignored.
 */
export function isTrustedReady(e: MessageLike, widgetOrigin: string, frameWindow: unknown): boolean {
  return (
    !!frameWindow &&
    e.origin === widgetOrigin &&
    e.source === frameWindow &&
    isRecord(e.data) &&
    e.data.source === SOURCE &&
    e.data.type === "ready"
  );
}

/** Origin of the loader's own script URL, so one build works on any domain. */
export function originOf(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    const origin = new URL(src).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}
