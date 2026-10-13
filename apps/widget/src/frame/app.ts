// Frame controller: wires the port, the session, the conversation, and the UI.
import { isMode, isRecord, type FrameToLoader, type Mode } from "../shared/protocol";
import { ApiError, CONVERSATION_ID, VISITOR_ID, createApi } from "./api";
import { SessionError, SessionManager, createTokenRequester, isTokenInvalid, type ActiveSession } from "./session";
import type { KeyValueStore } from "./storage";
import type { Message, SessionOut, Stage, WidgetConfig } from "./types";
import { MAX_LENGTH, createUi, type StateView } from "./ui";

export interface AppOptions {
  doc: Document;
  root: HTMLElement;
  cfg: WidgetConfig;
  parentOrigin: string;
  port: MessagePort;
  mode: Mode;
  token?: string;
  fetch: typeof fetch;
  storage: KeyValueStore;
}

export interface App {
  /** For tests: current conversation id. */
  conversationId(): string | null;
  sessions: SessionManager;
}

/** Thrown inside async flows that a reset made obsolete. Never shown. */
class Stale extends Error {}

const SIGN_IN: StateView = {
  title: "Sign in again",
  body: "Your sign in on this site has ended. Sign in again, then reopen the chat.",
  action: "Try again",
};

function minutes(seconds: number | null): string {
  if (seconds === null) return "a few minutes";
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? "a minute" : `${m} minutes`;
}

const isRateLimited = (e: unknown): e is ApiError =>
  e instanceof ApiError && (e.status === 429 || e.code === "rate_limited");

export function createApp(o: AppOptions): App {
  const { cfg, storage } = o;
  const api = createApi(cfg.apiBase, o.fetch);
  const post = (msg: FrameToLoader): void => o.port.postMessage(msg);
  const tokens = createTokenRequester(post);
  const conversationKey = `docent:conversation:${cfg.publicId}`;
  const visitorKey = `docent:visitor:${cfg.publicId}`;
  const contactKey = (id: string): string => `docent:contact:${id}`;

  const sessions: SessionManager = new SessionManager(
    {
      async createSession(token) {
        // Anonymous visitors send back the visitor_id from their last session in
        // this tab, so the server lets them resume their own conversation.
        const stored = token ? null : storage.get(visitorKey);
        const visitor = stored && VISITOR_ID.test(stored) ? stored : undefined;
        const created = await api.createSession({
          widget: cfg.publicId,
          parent_origin: o.parentOrigin,
          ...(token ? { token } : {}),
          ...(visitor ? { visitor_id: visitor } : {}),
        });
        if (!token && created.session.visitor_id && sessions.mode === "anonymous") {
          storage.set(visitorKey, created.session.visitor_id);
        }
        return created;
      },
      requestToken: () => tokens.request(),
    },
    o.mode,
    o.token ?? null,
  );

  let mode = o.mode;
  let isOpen = false;
  let unread = 0;
  let busy = false;
  let generation = 0;
  let seq = 0;
  let conversationId: string | null = null;
  let loading: Promise<void> | null = null;
  let inflight: AbortController | null = null;

  const ui = createUi(o.root, o.doc, {
    onSend: (text) => send(text),
    onClose() {
      isOpen = false;
      post({ type: "close" });
    },
    onRetry() {
      ui.showState(null);
      void load().catch(() => undefined);
      ui.focusInput();
    },
    onContact: (email) => contact(email),
  });

  const resetView = (): void => {
    ui.setMode(mode);
    ui.setHeader(cfg.name, null);
    ui.setGreeting(cfg.greeting);
    ui.setMessages([], null);
  };
  resetView();

  const setUnread = (n: number): void => {
    if (n === unread) return;
    unread = n;
    post({ type: "unread", count: n });
  };

  const applySession = (info: SessionOut): void => {
    const name = info.widget?.name || cfg.name;
    const userName = mode === "identified" ? info.user?.name : null;
    ui.setHeader(name, userName ? `Signed in as ${userName}` : null);
    ui.setGreeting(info.widget?.greeting || cfg.greeting);
  };

  const describe = (e: unknown): StateView => {
    if (e instanceof SessionError || isTokenInvalid(e)) return SIGN_IN;
    if (e instanceof ApiError) {
      if (e.code === "anonymous_disabled") return { title: "Chat is available after you sign in." };
      if (e.code === "origin_not_allowed" || e.code === "widget_not_found") {
        return { title: "Chat is not available on this site." };
      }
      if (e.code === "anonymous_cap") {
        return { title: "Chat is busy today", body: "Sign in or try again tomorrow." };
      }
      if (isRateLimited(e)) {
        return {
          title: "Too many chats from this network",
          body: `Try again in ${minutes(e.retryAfter)}.`,
          action: "Try again",
        };
      }
    }
    return { title: "The chat could not load.", body: "Check your connection and try again.", action: "Try again" };
  };

  const fail = (e: unknown): void => {
    ui.setStatus(null);
    ui.showState(describe(e));
    if (isOpen) ui.focusInput();
  };

  const alive = (gen: number): void => {
    if (gen !== generation) throw new Stale();
  };

  /** Runs an API call with a valid session; on a 401 gets a new session and retries once. */
  const withSession = async <T>(fn: (token: string) => Promise<T>): Promise<T> => {
    const s = await sessions.ensure();
    try {
      return await fn(s.token);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || isTokenInvalid(e)) throw e;
      sessions.invalidate();
      const fresh: ActiveSession = await sessions.ensure();
      applySession(fresh.info);
      return fn(fresh.token);
    }
  };

  const contactFor = (messages: Message[]): string | null => {
    if (mode !== "anonymous" || !conversationId || storage.get(contactKey(conversationId))) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].decision?.type === "escalate") return messages[i].id || null;
    }
    return null;
  };

  /** Session, then the conversation (resumed where possible). Shared by open and send. */
  const load = (): Promise<void> => {
    if (loading) return loading;
    const gen = generation;
    const run = async (): Promise<void> => {
      if (mode === "anonymous" && !cfg.anonymous) throw new ApiError(403, "anonymous_disabled", "Anonymous chat is off.");
      ui.setStatus("loading");
      const s = await sessions.ensure();
      alive(gen);
      applySession(s.info);
      const stored = mode === "anonymous" ? conversationId ?? storage.get(conversationKey) : null;
      const resume = stored && CONVERSATION_ID.test(stored) ? stored : null;
      const conversation = await withSession((t) => api.createConversation(t, resume));
      alive(gen);
      conversationId = conversation.id;
      if (mode === "anonymous") storage.set(conversationKey, conversation.id);
      ui.setMessages(conversation.messages, contactFor(conversation.messages));
      ui.setStatus(busy ? "searching" : null);
    };
    const p = run();
    loading = p;
    p.catch((e: unknown) => {
      if (loading === p) loading = null;
      if (gen === generation && !(e instanceof Stale)) fail(e);
    });
    return p;
  };

  const sendOnce = (content: string, signal: AbortSignal): Promise<Message> =>
    withSession((t) =>
      api.sendMessage(t, conversationId as string, content, (stage: Stage) => ui.setStatus(stage), signal),
    );

  const send = (text: string): boolean => {
    const content = text.trim();
    if (busy || !content || content.length > MAX_LENGTH) return false;
    busy = true;
    ui.setBusy(true);
    ui.setNotice(null);
    const gen = generation;
    const local: Message = {
      id: `local-${++seq}`,
      role: "visitor",
      content,
      decision: null,
      citations: [],
      created_at: null,
    };
    let bubble = ui.addMessage(local);
    ui.setStatus("searching");
    const controller = new AbortController();
    inflight = controller;

    const run = async (): Promise<void> => {
      try {
        await load();
      } catch {
        // load() already switched the panel to an error state.
        ui.removeMessage(bubble);
        ui.restoreInput(content);
        return;
      }
      alive(gen);
      let reply: Message;
      try {
        reply = await sendOnce(content, controller.signal);
      } catch (e) {
        // The conversation is gone, or belonged to an older anonymous session:
        // start or resume one and try once more.
        if (!(e instanceof ApiError) || e.code !== "not_found" || e.phase !== "request") throw e;
        conversationId = null;
        loading = null;
        storage.remove(conversationKey);
        await load();
        alive(gen);
        bubble = ui.addMessage(local);
        ui.setStatus("searching");
        reply = await sendOnce(content, controller.signal);
      }
      alive(gen);
      ui.addMessage(reply, contactFor([reply]));
      if (!isOpen && reply.role !== "visitor") setUnread(unread + 1);
    };

    run()
      .catch((e: unknown) => {
        if (gen !== generation || e instanceof Stale) return;
        if (e instanceof ApiError && e.code === "aborted") return;
        const beforeServer = !(e instanceof ApiError) || e.phase === "request";
        if (e instanceof SessionError || isTokenInvalid(e) || (e instanceof ApiError && e.status === 403)) {
          ui.removeMessage(bubble);
          ui.restoreInput(content);
          fail(e);
        } else if (isRateLimited(e)) {
          if (beforeServer) {
            ui.removeMessage(bubble);
            ui.restoreInput(content);
          }
          ui.setNotice(
            e.code === "anonymous_cap"
              ? "Chat is busy today. Sign in or try again tomorrow."
              : `You have reached the message limit for now. Try again in ${minutes(e.retryAfter)}.`,
          );
        } else if (beforeServer) {
          ui.removeMessage(bubble);
          ui.restoreInput(content);
          ui.setNotice("Your message was not sent. Check your connection and try again.");
        } else {
          ui.setNotice("The agent could not reply. Try again in a moment.");
        }
      })
      .finally(() => {
        if (inflight === controller) inflight = null;
        if (gen !== generation) return;
        busy = false;
        ui.setBusy(false);
        ui.setStatus(null);
      });
    return true;
  };

  const contact = async (email: string): Promise<string | null> => {
    const id = conversationId;
    if (!id) return "Could not save your email. Try again.";
    try {
      await withSession((t) => api.contact(t, id, email));
      storage.set(contactKey(id), "1");
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) return "Check the email address and try again.";
      if (isRateLimited(e)) return `Too many attempts. Try again in ${minutes(e.retryAfter)}.`;
      return "Could not save your email. Try again.";
    }
  };

  /** Create the session early so the first open is fast. Errors surface on open. */
  const warm = (): void => {
    if (mode === "anonymous" && !cfg.anonymous) return;
    sessions
      .ensure()
      .then((s) => applySession(s.info))
      .catch(() => undefined);
  };

  const onOpen = (): void => {
    isOpen = true;
    setUnread(0);
    sessions.keepAlive();
    void load().catch(() => undefined);
    ui.focusInput();
  };

  const onReset = (next: Mode): void => {
    generation++;
    inflight?.abort();
    inflight = null;
    busy = false;
    const old = sessions.reset(next);
    const revokes: Promise<void>[] = [];
    if (old.token) revokes.push(api.revoke(old.token));
    if (old.inflight) revokes.push(old.inflight.then((s) => api.revoke(s.token), () => undefined));
    storage.remove(conversationKey);
    storage.remove(visitorKey);
    if (conversationId) storage.remove(contactKey(conversationId));
    conversationId = null;
    loading = null;
    mode = next;
    ui.showState(null);
    ui.setBusy(false);
    ui.setStatus(null);
    ui.setNotice(null);
    ui.clearInput();
    resetView();
    setUnread(0);
    // Tell the loader once the server revoke has settled, so the host can
    // `await Docent.reset()` and then navigate away safely.
    void Promise.all(revokes).then(() => post({ type: "reset_done" }));
    if (isOpen) {
      sessions.keepAlive();
      void load().catch(() => undefined);
    } else if (mode === "identified") {
      warm();
    }
  };

  o.port.onmessage = (e: MessageEvent) => {
    const d: unknown = e.data;
    if (!isRecord(d)) return;
    if (d.type === "token") tokens.resolve(d.token);
    else if (d.type === "open") onOpen();
    else if (d.type === "close") isOpen = false;
    else if (d.type === "reset" && isMode(d.mode)) onReset(d.mode);
  };

  warm();

  return { conversationId: () => conversationId, sessions };
}
