import type { Mode } from "../shared/protocol";

export type Role = "visitor" | "agent" | "human" | "system";
export type Stage = "searching" | "writing" | "checking";

export interface Citation {
  marker: number;
  document_title: string;
  heading_path: string;
  url: string | null;
  excerpt: string;
}

export interface Decision {
  /** reply: conversation such as a greeting, with no facts and no citations. */
  type: "answer" | "clarify" | "escalate" | "reply";
  confidence: string | null;
  reason: string | null;
  citations: number[];
  /** Verified account claim keys the answer relies on (identified visitors). */
  account_facts: string[];
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  decision: Decision | null;
  citations: Citation[];
  created_at: string | null;
}

export interface SessionOut {
  session_token: string;
  expires_at: string;
  /** Seconds until expiry, measured on the server, so client clock skew does not matter. */
  expires_in: number | null;
  mode: Mode;
  /** Anonymous sessions only: send it back on the next session create to stay the same visitor. */
  visitor_id: string | null;
  user: { name: string | null } | null;
  widget: { name: string; greeting: string; suggestions: string[] } | null;
}

export interface Handoff {
  status: "open" | "assigned" | "waiting" | "resolved";
  /** The team already has an email to reply to. */
  contact_given: boolean;
}

export type ConversationStatus = "open" | "escalated" | "closed";

export interface ConversationOut {
  id: string;
  status: ConversationStatus;
  messages: Message[];
  /** The latest handoff to the team, if any. */
  handoff: Handoff | null;
}

/** One line in the recent chats list (signed-in customers only). */
export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  /** The customer's first message. */
  title: string;
  started_at: string;
  last_message_at: string;
}

/** Contents of <meta name="docent-widget"> in the frame page. */
export interface WidgetConfig {
  publicId: string;
  name: string;
  greeting: string;
  /** Questions offered under the greeting until the first message. */
  suggestions: string[];
  allowedOrigins: string[];
  anonymous: boolean;
  apiBase: string;
  /** Docent's website for "Powered by Docent"; null shows the line without a link. */
  siteUrl: string | null;
}
