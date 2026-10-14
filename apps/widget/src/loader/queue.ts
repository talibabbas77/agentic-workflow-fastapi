import { isRecord } from "../shared/protocol";

export interface InitOptions {
  widget?: string;
  getToken?: () => string | Promise<string>;
}

export interface OpenOptions {
  /** Text to put in the message field, at most 1000 characters. The visitor still presses Send. */
  prefill?: string;
}

export interface DocentApi {
  init(options?: InitOptions): void;
  open(options?: OpenOptions): void;
  close(): void;
  /** Resolves once the server session is revoked (or after 3 s). Await it before signing out. */
  reset(): Promise<void>;
}

export type Method = keyof DocentApi;

export const METHODS: readonly Method[] = ["init", "open", "close", "reset"];

/**
 * The stub a host page can paste before (or after) the script tag, so calls
 * made before loader.js arrives are queued and replayed in order:
 *
 *   window.Docent=window.Docent||{q:[]};["init","open","close","reset"].forEach(function(m){Docent[m]=Docent[m]||function(){Docent.q.push([m,arguments])}});
 */
export const STUB_SNIPPET =
  'window.Docent=window.Docent||{q:[]};["init","open","close","reset"].forEach(function(m){Docent[m]=Docent[m]||function(){Docent.q.push([m,arguments])}});';

function toArgs(args: unknown): unknown[] {
  if (args === undefined || args === null) return [];
  if (typeof args === "object" && typeof (args as { length?: unknown }).length === "number") {
    return Array.prototype.slice.call(args);
  }
  return [args];
}

/**
 * Installs the real API on `win.Docent`, then replays queued calls.
 * Queue entries are `[method, args]` where args is an array or an arguments
 * object; a single non-array value is treated as the only argument.
 * After install, `Docent.q.push(...)` runs calls immediately, so stub
 * functions a page captured earlier keep working.
 * Returns false when a loader is already installed (script tag added twice).
 */
export function installApi(win: { Docent?: unknown }, api: DocentApi, version: string): boolean {
  // Calls replayed from the queue return nothing; only direct calls after load
  // get reset()'s Promise.
  const target: Record<string, unknown> = isRecord(win.Docent) ? win.Docent : {};
  if (target.v) return false;
  const queued: unknown[] = Array.isArray(target.q) ? target.q.slice() : [];
  const run = (entry: unknown): void => {
    if (!Array.isArray(entry)) return;
    const name = entry[0] as Method;
    if (!METHODS.includes(name)) return;
    try {
      (api[name] as (...a: unknown[]) => void)(...toArgs(entry[1]));
    } catch (err) {
      console.error("Docent:", err);
    }
  };
  for (const name of METHODS) target[name] = api[name];
  target.v = version;
  target.q = {
    push(...entries: unknown[]) {
      entries.forEach(run);
      return 0;
    },
  };
  win.Docent = target;
  queued.forEach(run);
  return true;
}
