// Frame controller: wires the port, the session, the conversation, and the UI.
import { isMode, isPrefill, isRecord, type FrameToLoader, type Mode } from "../shared/protocol";
import { ApiError, CONVERSATION_ID, VISITOR_ID, createApi, isNoConversation } from "./api";
import { SessionError, SessionManager, createTokenRequester, isTokenInvalid, type ActiveSession } from "./session";
import type { KeyValueStore } from "./storage";
import type { ConversationOut, Message, SessionOut, Stage, Vote, WidgetConfig } from "./types";
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
  /** The visitor chose "New chat" and has not written in it yet: do not resume an older one. */
  const freshKey = `docent:new:${cfg.publicId}`;
  /** The larger panel, for the rest of this tab's visit. */
  const expandedKey = `docent:expanded:${cfg.publicId}`;

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
  /** The team already has an email for the current handoff (from the server, or sent here). */
  let contactGiven = false;
  let fresh = storage.get(freshKey) === "1";
  let expanded = storage.get(expandedKey) === "1";
  /** Bumped for each recent chats request, so only the latest one shows. */
  let historySeq = 0;

  const setFresh = (next: boolean): void => {
    fresh = next;
    if (next) storage.set(freshKey, "1");
    else storage.remove(freshKey);
  };

  /** An anonymous conversation this tab already started, if any. */
  const storedConversation = (): string | null => {
    if (mode !== "anonymous") return null;
    const id = storage.get(conversationKey);
    return id && CONVERSATION_ID.test(id) ? id : null;
  };

  /**
   * Whether opening the panel should load a conversation. Identified visitors
   * may have one on the server; anonymous ones only if this tab started one.
   * Otherwise (and after "New chat") the panel shows the greeting and nothing
   * is created until the first message is sent.
   */
  const hasHistory = (): boolean => !fresh && (mode === "identified" || storedConversation() !== null);

  const ui = createUi(
    o.root,
    o.doc,
    {
      onSend: (text) => send(text),
      onClose() {
        isOpen = false;
        post({ type: "close" });
      },
      onRetry() {
        ui.showState(null);
        if (hasHistory()) void load(false).catch(() => undefined);
        ui.focusInput();
      },
      onContact: (email) => contact(email),
      onRate: (messageId, vote, comment) => rate(messageId, vote, comment),
      onNewChat: () => newChat(),
      onHistory: () => void showHistory(),
      onPick: (id) => void pick(id),
      onExpand(next) {
        expanded = next;
        if (next) storage.set(expandedKey, "1");
        else storage.remove(expandedKey);
        ui.setExpanded(next);
        post({ type: "expand", expanded: next });
      },
    },
    cfg.siteUrl,
  );

  const resetView = (): void => {
    ui.setMode(mode);
    ui.setHeader(cfg.name, null);
    ui.setGreeting(cfg.greeting);
    ui.setSuggestions(cfg.suggestions);
    ui.setClosed(false);
    ui.showChat();
    ui.setMessages([], null);
    // History may replace the empty conversation; offer the suggestions once it has loaded.
    ui.allowSuggestions(!hasHistory());
  };
  resetView();
  ui.setExpanded(expanded);
  // The loader sizes the iframe; tell it about a choice made earlier in this tab.
  if (expanded) post({ type: "expand", expanded: true });

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
    ui.setSuggestions(info.widget?.suggestions.length ? info.widget.suggestions : cfg.suggestions);
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

  /** Anonymous visitors are asked for an email under the latest handoff, until the team has one. */
  const contactFor = (messages: Message[]): string | null => {
    if (mode !== "anonymous" || !conversationId || contactGiven) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].decision?.type === "escalate") return messages[i].id || null;
    }
    return null;
  };

  /** Make a conversation from the server the current one. */
  const adopt = (conversation: ConversationOut, replace: boolean): void => {
    conversationId = conversation.id;
    setFresh(false);
    if (mode === "anonymous") storage.set(conversationKey, conversation.id);
    // Ask for an email only under an unresolved handoff the team has no email
    // for. A later handoff in this conversation asks again.
    const handoff = conversation.handoff;
    const pending = handoff !== null && handoff.status !== "resolved";
    contactGiven = pending && handoff.contact_given;
    if (replace || conversation.messages.length > 0) {
      ui.setMessages(conversation.messages, pending ? contactFor(conversation.messages) : null);
    }
    ui.setClosed(conversation.status === "closed");
    ui.allowSuggestions(true);
  };

  /**
   * Session, then the conversation. Opening the panel only looks up history
   * (create=false: nothing is created, a 404 means there is none); the first
   * sent message creates one, a new one after "New chat". Concurrent calls
   * wait for the one in flight.
   */
  const load = (create: boolean): Promise<void> => {
    if (conversationId) return Promise.resolve();
    if (loading) return loading.then(() => load(create));
    if (!create && fresh) return Promise.resolve();
    const gen = generation;
    const run = async (): Promise<void> => {
      if (mode === "anonymous" && !cfg.anonymous) throw new ApiError(403, "anonymous_disabled", "Anonymous chat is off.");
      if (!busy) ui.setStatus("loading");
      const s = await sessions.ensure();
      alive(gen);
      applySession(s.info);
      const resume = mode === "anonymous" && !fresh ? storedConversation() : null;
      let conversation;
      try {
        conversation = await withSession((t) => api.createConversation(t, resume, create, create && fresh));
      } catch (e) {
        if (create || !isNoConversation(e)) throw e;
        // No history: show the greeting; the first message creates the conversation.
        alive(gen);
        storage.remove(conversationKey);
        ui.allowSuggestions(true);
        ui.setStatus(busy ? "searching" : null);
        return;
      }
      alive(gen);
      adopt(conversation, false);
      ui.setStatus(busy ? "searching" : null);
    };
    const p = run();
    loading = p;
    p.then(
      () => {
        if (loading === p) loading = null;
      },
      (e: unknown) => {
        if (loading === p) loading = null;
        if (gen === generation && !(e instanceof Stale)) fail(e);
      },
    );
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
      feedback: null,
    };
    let bubble = ui.addMessage(local);
    ui.setStatus("searching");
    const controller = new AbortController();
    inflight = controller;

    const run = async (): Promise<void> => {
      try {
        await load(true);
      } catch {
        // load() already switched the panel to an error state.
        ui.removeMessage(bubble);
        ui.restoreInput(content);
        return;
      }
      alive(gen);
      // Loading history replaces the list; put this message back after it.
      if (!bubble.isConnected) bubble = ui.addMessage(local);
      let reply: Message;
      try {
        reply = await sendOnce(content, controller.signal);
      } catch (e) {
        // The conversation is gone, belonged to an older anonymous session, or
        // the team closed it: start or resume one and try once more.
        const retry = e instanceof ApiError && e.phase === "request" && (e.code === "not_found" || e.code === "conversation_closed");
        if (!retry) throw e;
        conversationId = null;
        loading = null;
        storage.remove(conversationKey);
        if (e.code === "conversation_closed") {
          // A closed conversation is never continued: this message starts a new one.
          setFresh(true);
          ui.setMessages([], null);
          ui.setClosed(false);
          bubble = ui.addMessage(local);
        }
        await load(true);
        alive(gen);
        if (!bubble.isConnected) bubble = ui.addMessage(local);
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
      contactGiven = true;
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) return "Check the email address and try again.";
      if (isRateLimited(e)) return `Too many attempts. Try again in ${minutes(e.retryAfter)}.`;
      return "Could not save your email. Try again.";
    }
  };

  /** "Was this helpful?" Resolves to an error sentence, or null once saved. */
  const rate = async (messageId: string, vote: Vote | null, comment?: string): Promise<string | null> => {
    const id = conversationId;
    if (!id) return "Could not save that. Try again.";
    try {
      await withSession((t) => api.rate(t, id, messageId, vote, comment));
      return null;
    } catch (e) {
      if (isRateLimited(e)) return `Too many tries. Try again in ${minutes(e.retryAfter)}.`;
      return "Could not save that. Try again.";
    }
  };

  /**
   * "New chat": an empty conversation with the greeting and suggestions. Nothing
   * is created until the first message, which then asks for a new conversation
   * instead of resuming one. The previous conversation stays as it is for the
   * team; anonymous visitors lose the way back to it (its id is dropped).
   */
  const newChat = (): void => {
    if (busy) return;
    generation++;
    historySeq++;
    loading = null;
    conversationId = null;
    contactGiven = false;
    storage.remove(conversationKey);
    setFresh(true);
    ui.setNotice(null);
    ui.setStatus(null);
    ui.setClosed(false);
    ui.showChat();
    ui.setMessages([], null);
    ui.allowSuggestions(true);
    ui.focusInput();
  };

  /** The signed-in customer's recent chats on this widget. */
  const showHistory = async (): Promise<void> => {
    if (mode !== "identified" || busy) return;
    const seq = ++historySeq;
    ui.historyLoading("Loading your chats");
    try {
      const items = await withSession((t) => api.listConversations(t));
      if (seq === historySeq) ui.setHistory(items, conversationId);
    } catch (e) {
      if (seq !== historySeq) return;
      if (e instanceof SessionError || isTokenInvalid(e)) fail(e);
      else ui.historyError("Your chats could not load. Check your connection and try again.");
    }
  };

  /** Open a chat from the list. A closed one can be read; an open one can be continued. */
  const pick = async (id: string): Promise<void> => {
    if (mode !== "identified" || busy) return;
    const seq = ++historySeq;
    const gen = ++generation;
    loading = null;
    ui.historyLoading("Opening the chat");
    try {
      const conversation = await withSession((t) => api.getConversation(t, id));
      if (seq !== historySeq || gen !== generation) return;
      adopt(conversation, true);
      ui.setNotice(null);
      ui.setStatus(null);
      ui.showChat();
      ui.focusInput();
    } catch (e) {
      if (seq !== historySeq || gen !== generation) return;
      if (e instanceof SessionError || isTokenInvalid(e)) fail(e);
      else ui.historyError("That chat could not be opened. Try again.");
    }
  };

  /**
   * Identified visitors get a session as soon as the frame starts, so the first
   * open is fast. Anonymous sessions wait for history to load or a first message.
   * Errors surface on open.
   */
  const warm = (): void => {
    if (mode !== "identified") return;
    sessions
      .ensure()
      .then((s) => applySession(s.info))
      .catch(() => undefined);
  };

  const onOpen = (): void => {
    isOpen = true;
    setUnread(0);
    sessions.keepAlive();
    if (mode === "anonymous" && !cfg.anonymous) {
      fail(new ApiError(403, "anonymous_disabled", "Anonymous chat is off."));
    } else if (!conversationId && hasHistory()) {
      void load(false).catch(() => undefined);
    }
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
    setFresh(false);
    historySeq++;
    conversationId = null;
    loading = null;
    contactGiven = false;
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
    if (isOpen && hasHistory()) {
      sessions.keepAlive();
      void load(false).catch(() => undefined);
    } else if (mode === "identified") {
      warm();
    }
  };

  // When the loader focuses the iframe, put the visitor in the message field.
  // (A cross-origin frame cannot take focus on its own in every browser.)
  o.doc.defaultView?.addEventListener("focus", () => {
    const active = o.doc.activeElement;
    if (isOpen && (!active || active === o.doc.body)) ui.focusInput();
  });

  o.port.onmessage = (e: MessageEvent) => {
    const d: unknown = e.data;
    if (!isRecord(d)) return;
    if (d.type === "token") tokens.resolve(d.token);
    else if (d.type === "open") onOpen();
    else if (d.type === "close") isOpen = false;
    else if (d.type === "reset" && isMode(d.mode)) onReset(d.mode);
    // Phones get the full screen panel, so there is nothing to expand.
    else if (d.type === "layout" && typeof d.compact === "boolean") ui.setExpandable(!d.compact);
    else if (d.type === "prefill" && isPrefill(d.text)) ui.prefill(d.text.trim());
  };

  warm();

  return { conversationId: () => conversationId, sessions };
}
