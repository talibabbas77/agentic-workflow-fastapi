import { SOURCE, isMode, isRecord, type InitMessage, type MessageLike } from "../shared/protocol";

export interface InitContext {
  /** window.parent of the frame. */
  parent: unknown;
  /** Parent origin worked out at load time. */
  parentOrigin: string;
  allowedOrigins: readonly string[];
}

/**
 * The frame accepts "init" only from its direct parent window, from the origin
 * it saw at load time, and only if that origin is on the widget's allowlist.
 * The message must carry exactly one MessagePort.
 */
export function isTrustedInit(e: MessageLike, ctx: InitContext): e is MessageLike & { data: InitMessage } {
  if (e.source !== ctx.parent || !ctx.parent) return false;
  if (e.origin !== ctx.parentOrigin || !ctx.allowedOrigins.includes(e.origin)) return false;
  const d = e.data;
  if (!isRecord(d) || d.source !== SOURCE || d.type !== "init" || !isMode(d.mode)) return false;
  if (d.token !== undefined && (typeof d.token !== "string" || d.token.length > 16384)) return false;
  return !!e.ports && e.ports.length === 1;
}
