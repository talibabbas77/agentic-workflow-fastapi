import { toApiError, type ChatMessage } from "@docent/api-client";
import { readSse } from "../sse";
import { logInAgain } from "./browser";
import { NETWORK_ERROR } from "./result";

export type TurnStage = "searching" | "writing" | "checking";

export type TurnResult =
  | { kind: "reply"; message: ChatMessage }
  /** `stored` is true when the API kept the visitor's message before the turn failed. */
  | { kind: "failed"; message: string; stored: boolean }
  | { kind: "aborted" };

const RATE_LIMITED = "You sent several messages in a short time. Wait a minute, then try again.";
const CUT_OFF = "The connection closed before the agent replied. Try again.";

/**
 * One preview turn. The API streams progress as `status` events, then exactly one
 * `message` or `error`. Only the finished, checked reply is ever shown, so the
 * stream carries stages, not partial text. Never throws.
 */
export async function sendTurn(
  conversationId: string,
  content: string,
  onStage: (stage: TurnStage) => void,
  signal: AbortSignal,
): Promise<TurnResult> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/agent/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ content }),
      signal,
    });
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failed", message: NETWORK_ERROR.message, stored: false };
  }

  if (response.status === 401) return logInAgain();
  if (!response.ok || !response.body) {
    const message =
      response.status === 429
        ? RATE_LIMITED
        : toApiError(await response.json().catch(() => null), response.status).message;
    return { kind: "failed", message, stored: false };
  }

  // Assigned inside the event callback, so typed without narrowing to null.
  let reply = null as ChatMessage | null;
  let failure = null as string | null;
  try {
    await readSse(response.body, ({ event, data }) => {
      if (event === "status") onStage((JSON.parse(data) as { stage: TurnStage }).stage);
      else if (event === "message") reply = JSON.parse(data) as ChatMessage;
      else if (event === "error") failure = (JSON.parse(data) as { message: string }).message;
    });
  } catch {
    if (signal.aborted) return { kind: "aborted" };
  }
  if (reply) return { kind: "reply", message: reply };
  return { kind: "failed", message: failure ?? CUT_OFF, stored: true };
}
