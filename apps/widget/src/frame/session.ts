// Session lifecycle: create, refresh ahead of expiry, recover from a rejected
// identity token once, and drop everything on reset. The session token lives
// in memory only.
import type { FrameToLoader, Mode } from "../shared/protocol";
import { ApiError, type CreatedSession } from "./api";
import type { SessionOut } from "./types";

export class SessionError extends Error {
  constructor(readonly kind: "signin" | "reset") {
    super(kind === "signin" ? "The identity token was missing or rejected." : "The session was reset.");
    this.name = "SessionError";
  }
}

export interface ActiveSession {
  token: string;
  info: SessionOut;
  /** Local clock time at which the session expires (Infinity if unknown). */
  expiresAt: number;
}

export interface SessionDeps {
  createSession(identityToken?: string): Promise<CreatedSession>;
  /** Asks the loader for a fresh identity token over the port. */
  requestToken(): Promise<string | null>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const REFRESH_LEAD_MS = 60_000;
export const MIN_REFRESH_DELAY_MS = 5_000;
const MAX_TIMER_MS = 2_147_483_647;
/** A session this close to expiry is treated as expired before use. */
export const EXPIRY_MARGIN_MS = 5_000;

/**
 * Delay before refreshing a session with `remainingMs` left: one minute early
 * for normal lifetimes, a fifth of the lifetime early for short ones, never
 * sooner than five seconds (protects against refresh loops).
 */
export function refreshDelay(remainingMs: number): number {
  const lead = Math.min(REFRESH_LEAD_MS, Math.max(0, remainingMs / 5));
  return Math.min(MAX_TIMER_MS, Math.max(MIN_REFRESH_DELAY_MS, Math.floor(remainingMs - lead)));
}

export class SessionManager {
  private current: ActiveSession | null = null;
  private pending: Promise<ActiveSession> | null = null;
  /** The raw creation behind `pending`, so a reset can still revoke what it produces. */
  private creating: Promise<ActiveSession> | null = null;
  private timer: unknown = null;
  private autoRefresh = false;
  private generation = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly deps: SessionDeps,
    public mode: Mode,
    /** Token that came with "init". Used once; later sessions ask the loader. */
    private initialToken: string | null = null,
  ) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get session(): ActiveSession | null {
    return this.current;
  }

  /** A usable session: the current one, or a new one if missing or about to expire. */
  ensure(): Promise<ActiveSession> {
    const c = this.current;
    if (c && this.now() < c.expiresAt - EXPIRY_MARGIN_MS) return Promise.resolve(c);
    return this.acquire();
  }

  /** Creates a new session (sharing one in-flight request between callers). */
  acquire(): Promise<ActiveSession> {
    if (this.pending) return this.pending;
    const gen = this.generation;
    const raw = this.create();
    this.creating = raw;
    const p = raw.then((s) => {
      if (gen !== this.generation) throw new SessionError("reset");
      this.current = s;
      this.schedule();
      return s;
    });
    this.pending = p;
    const clear = (): void => {
      if (this.pending === p) this.pending = null;
      if (this.creating === raw) this.creating = null;
    };
    p.then(clear, clear);
    return p;
  }

  /** Start refreshing ahead of expiry. Called once the visitor opens the chat. */
  keepAlive(): void {
    if (this.autoRefresh) return;
    this.autoRefresh = true;
    this.schedule();
  }

  /** Forget the current session (for example after a 401) without touching the timer settings. */
  invalidate(): void {
    this.current = null;
    this.stopTimer();
  }

  /**
   * Drop everything for a reset. Returns what the caller must revoke on the
   * server: the current session token, and any session still being created.
   */
  reset(mode: Mode): { token: string | null; inflight: Promise<ActiveSession> | null } {
    const old = { token: this.current?.token ?? null, inflight: this.creating };
    this.generation++;
    this.current = null;
    this.pending = null;
    this.creating = null;
    this.initialToken = null;
    this.autoRefresh = false;
    this.stopTimer();
    this.mode = mode;
    return old;
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.stopTimer();
    const c = this.current;
    if (!this.autoRefresh || !c || !Number.isFinite(c.expiresAt)) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      // A failed refresh keeps the old session until it expires; the next
      // ensure() then tries again and surfaces any error to the visitor.
      this.acquire().catch(() => undefined);
    }, refreshDelay(c.expiresAt - this.now()));
  }

  private async create(): Promise<ActiveSession> {
    if (this.mode === "anonymous") return this.open(undefined);
    let token = this.initialToken;
    this.initialToken = null;
    if (!token) token = await this.deps.requestToken();
    if (!token) throw new SessionError("signin");
    try {
      return await this.open(token);
    } catch (err) {
      if (!isTokenInvalid(err)) throw err;
    }
    // The identity token was rejected: ask for a fresh one, once.
    const fresh = await this.deps.requestToken();
    if (!fresh || fresh === token) throw new SessionError("signin");
    try {
      return await this.open(fresh);
    } catch (err) {
      if (isTokenInvalid(err)) throw new SessionError("signin");
      throw err;
    }
  }

  private async open(identityToken: string | undefined): Promise<ActiveSession> {
    const { session } = await this.deps.createSession(identityToken);
    const now = this.now();
    // expires_in is measured on the server, so a wrong client clock cannot cause
    // a refresh loop. expires_at is only a fallback for an older API.
    const remaining =
      session.expires_in !== null && session.expires_in > 0
        ? session.expires_in * 1000
        : Date.parse(session.expires_at) - now;
    return {
      token: session.session_token,
      info: session,
      expiresAt: Number.isFinite(remaining) && remaining > 0 ? now + remaining : Number.POSITIVE_INFINITY,
    };
  }
}

export function isTokenInvalid(err: unknown): boolean {
  return err instanceof ApiError && err.code === "token_invalid";
}

/**
 * Token requests over the port. One request in flight at a time; replies are
 * matched in order. A missing reply resolves to null after `timeoutMs`.
 */
export function createTokenRequester(post: (msg: FrameToLoader) => void, timeoutMs = 15_000) {
  let waiting: ((token: string | null) => void) | null = null;
  let inflight: Promise<string | null> | null = null;
  return {
    request(): Promise<string | null> {
      if (inflight) return inflight;
      inflight = new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => finish(null), timeoutMs);
        const finish = (token: string | null): void => {
          clearTimeout(timer);
          waiting = null;
          inflight = null;
          resolve(token);
        };
        waiting = finish;
        post({ type: "token" });
      });
      return inflight;
    },
    /** Called with the loader's {type:"token"} reply. */
    resolve(token: unknown): void {
      if (waiting) waiting(typeof token === "string" && token ? token : null);
    },
  };
}
