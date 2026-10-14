// Same-origin client for /v1/widget. Every call after session creation sends
// "Authorization: Bearer <session_token>". No cookies are sent or needed.
import { isRecord } from "../shared/protocol";
import { parseSuggestions } from "./config";
import { readSse } from "./sse";
import type {
  Citation,
  ConversationOut,
  ConversationStatus,
  ConversationSummary,
  Decision,
  Handoff,
  Message,
  Role,
  SessionOut,
  Stage,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Seconds from the Retry-After header, when the server sent one. */
    readonly retryAfter: number | null = null,
    /** "request": failed before the server accepted it. "stream": failed after. */
    readonly phase: "request" | "stream" = "request",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface CreatedSession {
  session: SessionOut;
}

export interface SessionRequest {
  widget: string;
  parent_origin: string;
  token?: string;
  visitor_id?: string;
}

/** Server pattern for visitor ids. */
export const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** Conversation ids are UUIDs; anything else in storage is ignored. */
export const CONVERSATION_ID = /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;

export interface Api {
  createSession(body: SessionRequest): Promise<CreatedSession>;
  /**
   * Resume this visitor's conversation, or start one. With create=false it only
   * looks up history and throws ApiError 404 "no_conversation" when there is none.
   * fresh=true always starts a new one (the visitor chose "New chat").
   */
  createConversation(
    sessionToken: string,
    resumeId?: string | null,
    create?: boolean,
    fresh?: boolean,
  ): Promise<ConversationOut>;
  /** The signed-in customer's latest conversations on this widget. Empty for anonymous visitors. */
  listConversations(sessionToken: string): Promise<ConversationSummary[]>;
  /** One of this visitor's own conversations. 404 "not_found" for anything else. */
  getConversation(sessionToken: string, conversationId: string): Promise<ConversationOut>;
  sendMessage(
    sessionToken: string,
    conversationId: string,
    content: string,
    onStatus: (stage: Stage) => void,
    signal?: AbortSignal,
  ): Promise<Message>;
  contact(sessionToken: string, conversationId: string, email: string): Promise<void>;
  revoke(sessionToken: string): Promise<void>;
}

const ROLES: readonly Role[] = ["visitor", "agent", "human", "system"];
const HANDOFF: readonly Handoff["status"][] = ["open", "assigned", "waiting", "resolved"];
const STAGES: readonly Stage[] = ["searching", "writing", "checking"];
const DECISIONS: readonly Decision["type"][] = ["answer", "clarify", "escalate", "reply"];
const STATUSES: readonly ConversationStatus[] = ["open", "escalated", "closed"];

const asStatus = (v: unknown): ConversationStatus => (STATUSES.includes(v as ConversationStatus) ? (v as ConversationStatus) : "open");

export const isStage = (v: unknown): v is Stage => STAGES.includes(v as Stage);

/** The visitor has no conversation to resume (create=false lookups only). */
export const isNoConversation = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 404 && e.code === "no_conversation";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function asCitation(v: unknown): Citation | null {
  if (!isRecord(v) || typeof v.marker !== "number" || !Number.isFinite(v.marker)) return null;
  return {
    marker: v.marker,
    document_title: str(v.document_title),
    heading_path: str(v.heading_path),
    url: typeof v.url === "string" ? v.url : null,
    excerpt: str(v.excerpt),
  };
}

/** Defensive parse of a Message: unknown fields dropped, missing ones defaulted. */
export function asMessage(v: unknown): Message | null {
  if (!isRecord(v) || typeof v.content !== "string") return null;
  const d = v.decision;
  const decision: Decision | null =
    isRecord(d) && DECISIONS.includes(d.type as Decision["type"])
      ? {
          type: d.type as Decision["type"],
          confidence: typeof d.confidence === "string" ? d.confidence : null,
          reason: typeof d.reason === "string" ? d.reason : null,
          citations: Array.isArray(d.citations) ? d.citations.filter((n): n is number => typeof n === "number") : [],
          account_facts: Array.isArray(d.account_facts)
            ? d.account_facts.filter((k): k is string => typeof k === "string")
            : [],
        }
      : null;
  return {
    id: v.id === undefined || v.id === null ? "" : String(v.id),
    role: ROLES.includes(v.role as Role) ? (v.role as Role) : "system",
    content: v.content,
    decision,
    citations: Array.isArray(v.citations)
      ? v.citations.map(asCitation).filter((c): c is Citation => c !== null)
      : [],
    created_at: typeof v.created_at === "string" ? v.created_at : null,
  };
}

function asConversation(data: unknown, status: number): ConversationOut {
  if (!isRecord(data) || data.id === undefined || data.id === null) {
    throw new ApiError(status, "bad_response", "The conversation reply was missing an id.");
  }
  const h = data.handoff;
  return {
    id: String(data.id),
    status: asStatus(data.status),
    messages: Array.isArray(data.messages) ? data.messages.map(asMessage).filter((m): m is Message => m !== null) : [],
    handoff:
      isRecord(h) && HANDOFF.includes(h.status as Handoff["status"])
        ? { status: h.status as Handoff["status"], contact_given: h.contact_given === true }
        : null,
  };
}

function asSummary(v: unknown): ConversationSummary | null {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.title !== "string") return null;
  return {
    id: v.id,
    status: asStatus(v.status),
    title: v.title,
    started_at: str(v.started_at),
    last_message_at: str(v.last_message_at),
  };
}

function retryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - Date.now()) / 1000)) : null;
}

/** Reads the API error body: {"error": {"code", "message"}}, tolerating FastAPI's {"detail": ...}. */
async function toError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: fall through to a status based code.
  }
  let code = "";
  let message = "";
  const pick = (v: unknown): void => {
    if (!isRecord(v)) return;
    code ||= str(v.code);
    message ||= str(v.message);
  };
  if (isRecord(body)) {
    pick(body.error);
    pick(body.detail);
    pick(body);
    if (!code && typeof body.detail === "string") code = body.detail;
  }
  if (!code) code = res.status === 429 ? "rate_limited" : `http_${res.status}`;
  return new ApiError(res.status, code, message || `Request failed with status ${res.status}.`, retryAfter(res));
}

export function createApi(base: string, fetchImpl: typeof fetch): Api {
  const call = async (
    path: string,
    init: { method: string; token?: string; body?: unknown; accept?: string; signal?: AbortSignal; keepalive?: boolean },
  ): Promise<Response> => {
    const headers: Record<string, string> = { Accept: init.accept ?? "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let res: Response;
    try {
      res = await fetchImpl(base + path, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "omit",
        cache: "no-store",
        signal: init.signal,
        keepalive: init.keepalive,
      });
    } catch (err) {
      if (init.signal?.aborted) throw new ApiError(0, "aborted", "Request cancelled.");
      throw new ApiError(0, "network", err instanceof Error ? err.message : "Network error.");
    }
    if (!res.ok) throw await toError(res);
    return res;
  };

  const json = async (res: Response): Promise<unknown> => {
    try {
      return await res.json();
    } catch {
      throw new ApiError(res.status, "bad_response", "The server sent a reply the widget could not read.");
    }
  };

  return {
    async createSession(body) {
      const res = await call("/sessions", { method: "POST", body });
      const data = await json(res);
      if (!isRecord(data) || typeof data.session_token !== "string" || !data.session_token) {
        throw new ApiError(res.status, "bad_response", "The session reply was missing a token.");
      }
      return {
        session: {
          session_token: data.session_token,
          expires_at: str(data.expires_at),
          expires_in:
            typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : null,
          mode: data.mode === "identified" ? "identified" : "anonymous",
          visitor_id: typeof data.visitor_id === "string" && VISITOR_ID.test(data.visitor_id) ? data.visitor_id : null,
          user: isRecord(data.user) ? { name: typeof data.user.name === "string" ? data.user.name : null } : null,
          widget: isRecord(data.widget)
            ? {
                name: str(data.widget.name),
                greeting: str(data.widget.greeting),
                suggestions: parseSuggestions(data.widget.suggestions),
              }
            : null,
        },
      };
    },

    async createConversation(token, resumeId, create = true, fresh = false) {
      const res = await call("/conversations", {
        method: "POST",
        token,
        body: fresh
          ? { new: true }
          : { ...(resumeId ? { resume_id: resumeId } : {}), ...(create ? {} : { create: false }) },
      });
      return asConversation(await json(res), res.status);
    },

    async listConversations(token) {
      const res = await call("/conversations", { method: "GET", token });
      const data = await json(res);
      return Array.isArray(data) ? data.map(asSummary).filter((c): c is ConversationSummary => c !== null) : [];
    },

    async getConversation(token, conversationId) {
      const res = await call(`/conversations/${encodeURIComponent(conversationId)}`, { method: "GET", token });
      return asConversation(await json(res), res.status);
    },

    async sendMessage(token, conversationId, content, onStatus, signal) {
      const res = await call(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        token,
        body: { content },
        accept: "text/event-stream",
        signal,
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.body || !type.includes("text/event-stream")) {
        const message = asMessage(await json(res));
        if (message) return message;
        throw new ApiError(res.status, "bad_response", "The reply could not be read.", null, "stream");
      }
      let reply = null as Message | null;
      let failure = null as ApiError | null;
      try {
        await readSse(
          res.body,
          (event) => {
            let data: unknown;
            try {
              data = JSON.parse(event.data);
            } catch {
              return;
            }
            if (event.event === "status") {
              if (isRecord(data) && isStage(data.stage)) onStatus(data.stage);
            } else if (event.event === "message") {
              reply = asMessage(data) ?? reply;
            } else if (event.event === "error") {
              const d = isRecord(data) ? data : {};
              failure = new ApiError(200, str(d.code) || "agent_error", str(d.message) || "The agent could not reply.", null, "stream");
            }
          },
          signal,
        );
      } catch {
        if (signal?.aborted) throw new ApiError(0, "aborted", "Request cancelled.");
        failure ??= new ApiError(0, "stream_broken", "The connection dropped before the reply arrived.", null, "stream");
      }
      if (signal?.aborted) throw new ApiError(0, "aborted", "Request cancelled.");
      if (reply) return reply;
      throw failure ?? new ApiError(0, "stream_ended", "The reply ended before a message arrived.", null, "stream");
    },

    async contact(token, conversationId, email) {
      await call(`/conversations/${encodeURIComponent(conversationId)}/contact`, {
        method: "POST",
        token,
        body: { email },
      });
    },

    async revoke(token) {
      try {
        // keepalive lets the request finish even if the frame is torn down right after.
        await call("/sessions/current", { method: "DELETE", token, keepalive: true });
      } catch {
        // The session expires on its own; nothing useful to show the visitor.
      }
    },
  };
}
