// Frame start up: read config, verify the embedding origin, say "ready" to the
// parent, and wait for a trusted "init" carrying the MessagePort.
import { SOURCE, type ReadyMessage } from "../shared/protocol";
import { createApp, type App } from "./app";
import { isTrustedInit } from "./checks";
import { parentOriginFrom, readConfig } from "./config";
import type { KeyValueStore } from "./storage";

export interface BootEnv {
  win: Window;
  doc: Document;
  fetch: typeof fetch;
  storage: KeyValueStore;
  /** Defaults to win.parent. */
  parent?: Window;
  /** Called once init is accepted (tests use it to reach the app). */
  onApp?: (app: App) => void;
}

/** Returns false when the frame must stay blank (bad config, not framed, or origin not allowed). */
export function boot(env: BootEnv): boolean {
  const { win, doc } = env;
  const parent = env.parent ?? win.parent;
  const cfg = readConfig(doc);
  const root = doc.getElementById("docent");
  if (!cfg || !root || !parent || parent === win) return false;

  const ancestors = (win.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  const parentOrigin = parentOriginFrom(ancestors, doc.referrer);
  if (!parentOrigin || !cfg.allowedOrigins.includes(parentOrigin)) return false;

  const ctx = { parent, parentOrigin, allowedOrigins: cfg.allowedOrigins };
  const onMessage = (e: MessageEvent): void => {
    if (!isTrustedInit(e, ctx)) return;
    win.removeEventListener("message", onMessage);
    const app = createApp({
      doc,
      root,
      cfg,
      parentOrigin,
      port: e.ports[0],
      mode: e.data.mode,
      token: e.data.token,
      fetch: env.fetch,
      storage: env.storage,
    });
    env.onApp?.(app);
  };
  win.addEventListener("message", onMessage);
  const ready: ReadyMessage = { source: SOURCE, type: "ready" };
  parent.postMessage(ready, parentOrigin);
  return true;
}
