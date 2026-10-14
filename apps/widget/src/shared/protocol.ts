// Messages between loader.js (host page) and the widget iframe.
//
// Handshake over window.postMessage (the only two messages that use it):
//   frame  -> parent  { source: "docent", type: "ready" }                     targetOrigin = parent origin
//   loader -> frame   { source: "docent", type: "init", mode, token? }       targetOrigin = widget origin, transfers port2
//
// Everything after the handshake goes over the transferred MessagePort.

export const SOURCE = "docent";

/** Docent.reset() resolves at the latest after this long, so sign out never hangs. */
export const RESET_TIMEOUT_MS = 3000;

/** Longest text Docent.open({ prefill }) may put in the message field. */
export const PREFILL_MAX_LENGTH = 1000;

export type Mode = "identified" | "anonymous";

export interface ReadyMessage {
  source: typeof SOURCE;
  type: "ready";
}

export interface InitMessage {
  source: typeof SOURCE;
  type: "init";
  mode: Mode;
  token?: string;
}

/** Over the port, frame to loader. */
export type FrameToLoader =
  | { type: "token" }
  | { type: "close" }
  | { type: "unread"; count: number }
  /** Answer to {type:"reset"}: the server revoke has settled and local state is cleared. */
  | { type: "reset_done" }
  /** The visitor wants the larger panel (true) or the normal one (false). The loader sizes the iframe. */
  | { type: "expand"; expanded: boolean };

/** Over the port, loader to frame. */
export type LoaderToFrame =
  | { type: "token"; token: string | null }
  | { type: "open" }
  | { type: "close" }
  | { type: "reset"; mode: Mode }
  /** Sent after init and on every change. compact: a phone sized page, where the panel is full screen. */
  | { type: "layout"; compact: boolean }
  /** From Docent.open({ prefill }). The frame puts it in the message field and never sends it by itself. */
  | { type: "prefill"; text: string };

/** Minimal shape of a MessageEvent that the origin checks look at. */
export interface MessageLike {
  origin: string;
  source: unknown;
  data: unknown;
  ports?: ReadonlyArray<unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMode(value: unknown): value is Mode {
  return value === "identified" || value === "anonymous";
}

/** Text for the message field: a non-blank string of at most PREFILL_MAX_LENGTH characters. */
export function isPrefill(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= PREFILL_MAX_LENGTH;
}
