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
  type: "answer" | "clarify" | "escalate";
  confidence: string | null;
  reason: string | null;
  citations: number[];
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
  mode: Mode;
  /** Anonymous sessions only: send it back on the next session create to stay the same visitor. */
  visitor_id: string | null;
  user: { name: string | null } | null;
  widget: { name: string; greeting: string } | null;
}

export interface ConversationOut {
  id: string;
  status: string;
  messages: Message[];
}

/** Contents of <meta name="docent-widget"> in the frame page. */
export interface WidgetConfig {
  publicId: string;
  name: string;
  greeting: string;
  allowedOrigins: string[];
  anonymous: boolean;
  apiBase: string;
}
