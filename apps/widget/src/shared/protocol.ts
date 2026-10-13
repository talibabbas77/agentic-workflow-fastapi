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
  | { type: "reset_done" };

/** Over the port, loader to frame. */
export type LoaderToFrame =
  | { type: "token"; token: string | null }
  | { type: "open" }
  | { type: "close" }
  | { type: "reset"; mode: Mode };

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
