import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type CreatedSession } from "../src/frame/api";
import {
  MIN_REFRESH_DELAY_MS,
  SessionError,
  SessionManager,
  createTokenRequester,
  refreshDelay,
} from "../src/frame/session";

const MIN = 60_000;
const T0 = Date.parse("2026-10-14T10:00:00Z");

function created(token: string, lifetimeMs = 30 * MIN, expiresAt?: number): CreatedSession {
  return {
    session: {
      session_token: token,
      expires_at: new Date(expiresAt ?? Date.now() + lifetimeMs).toISOString(),
      expires_in: Math.round(lifetimeMs / 1000),
      mode: "identified",
      visitor_id: null,
      user: { name: "Sam" },
      widget: { name: "Lumen Notes", greeting: "Hi" },
    },
  };
}

describe("refreshDelay", () => {
  it("refreshes one minute early for a 30 minute session", () => {
    expect(refreshDelay(30 * MIN)).toBe(29 * MIN);
  });

  it("refreshes a fifth early for short sessions", () => {
    expect(refreshDelay(2 * MIN)).toBe(96_000);
  });

  it("never schedules sooner than the minimum delay (no refresh loops)", () => {
    expect(refreshDelay(1_000)).toBe(MIN_REFRESH_DELAY_MS);
    expect(refreshDelay(-5 * MIN)).toBe(MIN_REFRESH_DELAY_MS);
  });

  it("caps the delay at what setTimeout supports", () => {
    expect(refreshDelay(60 * 24 * 60 * MIN)).toBe(2_147_483_647);
  });
});

describe("SessionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("identified: uses the init token first, then asks the loader for a new one on refresh", async () => {
    const createSession = vi.fn(async (token?: string) => created(`s-${token}`));
    const requestToken = vi.fn(async () => "jwt-2");
    const m = new SessionManager({ createSession, requestToken }, "identified", "jwt-1");

    const first = await m.ensure();
    expect(first.token).toBe("s-jwt-1");
    expect(createSession).toHaveBeenLastCalledWith("jwt-1");
    expect(requestToken).not.toHaveBeenCalled();

    // No refresh timer until the visitor opens the chat.
    await vi.advanceTimersByTimeAsync(29 * MIN + 1);
    expect(createSession).toHaveBeenCalledTimes(1);

    m.keepAlive();
    // The session was created at T0 with 30 minutes and just under one minute is
    // left, so the refresh is due a fifth of that early.
    const due = refreshDelay(MIN - 1);
    await vi.advanceTimersByTimeAsync(due - 10);
    expect(requestToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(requestToken).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenLastCalledWith("jwt-2");
    expect(m.session?.token).toBe("s-jwt-2");
  });

  it("schedules the refresh one minute before expires_at", async () => {
    const createSession = vi.fn(async () => created("s"));
    const m = new SessionManager({ createSession, requestToken: async () => null }, "anonymous");
    m.keepAlive();
    await m.ensure();
    expect(createSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29 * MIN - 10);
    expect(createSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(createSession).toHaveBeenCalledTimes(2);
    // Anonymous refresh never asks for an identity token.
    expect(createSession).toHaveBeenLastCalledWith(undefined);
    // And it keeps going: the next refresh is scheduled from the new session.
    await vi.advanceTimersByTimeAsync(29 * MIN);
    expect(createSession).toHaveBeenCalledTimes(3);
  });

  it("uses expires_in, so a wrong client clock cannot cause a refresh loop", async () => {
    // Client clock is 2 hours fast: by local time expires_at is already in the past.
    const createSession = vi.fn(async () => created("s", 30 * MIN, T0 - 90 * MIN));
    const m = new SessionManager({ createSession, requestToken: async () => null }, "anonymous");
    m.keepAlive();
    const s = await m.ensure();
    expect(s.expiresAt).toBe(T0 + 30 * MIN);
    await vi.advanceTimersByTimeAsync(28 * MIN);
    expect(createSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 * MIN + 1);
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("falls back to expires_at when expires_in is missing", async () => {
    const createSession = vi.fn(async () => {
      const c = created("s", 10 * MIN);
      c.session.expires_in = null;
      return c;
    });
    const m = new SessionManager({ createSession, requestToken: async () => null }, "anonymous");
    const s = await m.ensure();
    expect(s.expiresAt).toBe(T0 + 10 * MIN);
  });

  it("ensure() replaces a session that is about to expire before use", async () => {
    const createSession = vi.fn(async () => created(`s${createSession.mock.calls.length}`, 10 * MIN));
    const m = new SessionManager({ createSession, requestToken: async () => null }, "anonymous");
    await m.ensure();
    vi.setSystemTime(T0 + 10 * MIN - 1_000);
    const s = await m.ensure();
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(s.token).toBe("s2");
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const createSession = vi.fn(async () => created("s"));
    const m = new SessionManager({ createSession, requestToken: async () => null }, "anonymous");
    const [a, b] = await Promise.all([m.ensure(), m.ensure()]);
    expect(a).toBe(b);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("token_invalid: requests a fresh token once, then succeeds", async () => {
    const createSession = vi.fn(async (token?: string) => {
      if (token === "old") throw new ApiError(401, "token_invalid", "rejected");
      return created(`s-${token}`);
    });
    const requestToken = vi.fn(async () => "new");
    const m = new SessionManager({ createSession, requestToken }, "identified", "old");
    const s = await m.ensure();
    expect(s.token).toBe("s-new");
    expect(requestToken).toHaveBeenCalledTimes(1);
  });

  it("token_invalid twice: gives up with a sign in error after one retry", async () => {
    const createSession = vi.fn(async () => {
      throw new ApiError(401, "token_invalid", "rejected");
    });
    const requestToken = vi.fn(async () => "another");
    const m = new SessionManager({ createSession, requestToken }, "identified", "first");
    await expect(m.ensure()).rejects.toEqual(new SessionError("signin"));
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(requestToken).toHaveBeenCalledTimes(1);
  });

  it("identified with no token available: sign in error without calling the API", async () => {
    const createSession = vi.fn(async () => created("s"));
    const m = new SessionManager({ createSession, requestToken: async () => null }, "identified");
    await expect(m.ensure()).rejects.toBeInstanceOf(SessionError);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("other errors pass through untouched", async () => {
    const err = new ApiError(429, "rate_limited", "slow down", 120);
    const m = new SessionManager(
      {
        createSession: async () => {
          throw err;
        },
        requestToken: async () => null,
      },
      "anonymous",
    );
    await expect(m.ensure()).rejects.toBe(err);
  });

  it("reset drops the session, stops the timer, and ignores a creation already in flight", async () => {
    let release: (v: CreatedSession) => void = () => undefined;
    const createSession = vi
      .fn<(token?: string) => Promise<CreatedSession>>()
      .mockImplementationOnce(async () => created("first"))
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockImplementation(async () => created("after-reset"));
    const m = new SessionManager({ createSession, requestToken: async () => "jwt" }, "identified", "jwt");
    m.keepAlive();
    await m.ensure();
    m.invalidate();
    const stale = m.ensure();
    // Let the creation reach createSession before resetting.
    await vi.advanceTimersByTimeAsync(0);
    expect(createSession).toHaveBeenCalledTimes(2);
    const dropped = m.reset("anonymous");
    // Invalidated, so no current token; but the creation in flight is handed back to revoke.
    expect(dropped.token).toBeNull();
    expect(dropped.inflight).not.toBeNull();
    release(created("stale"));
    await expect(stale).rejects.toEqual(new SessionError("reset"));
    expect((await dropped.inflight)?.token).toBe("stale");
    expect(m.session).toBeNull();
    const fresh = await m.ensure();
    expect(fresh.token).toBe("after-reset");
    expect(createSession).toHaveBeenLastCalledWith(undefined);
    expect(m.reset("anonymous")).toEqual({ token: "after-reset", inflight: null });
    // No refresh timer survives a reset.
    const calls = createSession.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(createSession.mock.calls.length).toBe(calls);
  });
});

describe("createTokenRequester", () => {
  it("posts one request and resolves with the reply", async () => {
    const post = vi.fn();
    const r = createTokenRequester(post);
    const a = r.request();
    const b = r.request();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: "token" });
    r.resolve("jwt");
    expect(await a).toBe("jwt");
    expect(await b).toBe("jwt");
  });

  it("treats an empty or non string reply as no token", async () => {
    const r = createTokenRequester(() => undefined);
    const p = r.request();
    r.resolve(42);
    expect(await p).toBeNull();
  });

  it("times out to null when the loader never answers", async () => {
    vi.useFakeTimers();
    const r = createTokenRequester(() => undefined, 1_000);
    const p = r.request();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });
});
