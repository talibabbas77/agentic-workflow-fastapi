import type { EvalCheck, EvalExpected, EvalRunStatus, EvalVerdict } from "@docent/api-client";
import { CheckIcon, MinusIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export const expectedOptions = [
  { value: "answer", label: "Answer" },
  { value: "escalate", label: "Hand off" },
  { value: "clarify", label: "Ask to clarify" },
] as const satisfies readonly { value: EvalExpected; label: string }[];

export const expectedLabel: Record<EvalExpected, string> = {
  answer: "Should answer",
  escalate: "Should hand off",
  clarify: "Should ask to clarify",
};

export const replyLabel: Record<string, string> = {
  answer: "Answered",
  clarify: "Asked to clarify",
  escalate: "Handed off",
  reply: "Replied politely",
};

export const verdictLabel: Record<EvalVerdict, string> = {
  correct: "Correct",
  wrong: "Wrong",
  unsupported: "Not backed by sources",
  escalated_correctly: "Handed off as expected",
  escalated_wrongly: "Handed off instead",
  missed: "Did not answer",
  error: "Could not run",
};

/** What each verdict means, for a hint next to it. */
export const verdictHint: Record<EvalVerdict, string> = {
  correct: "The expected outcome, and the judge agreed with the answer.",
  wrong: "An answer that failed a check or the judge, or an answer where a handoff was expected.",
  unsupported: "The judge found claims the cited sources do not contain.",
  escalated_correctly: "A handoff where one was expected.",
  escalated_wrongly: "A handoff where an answer was expected. Nothing wrong was said.",
  missed: "A clarifying question or a polite reply where something else was expected.",
  error: "The turn or the judge failed, so this case is left out of the rates.",
};

export const PASSING = new Set<EvalVerdict>(["correct", "escalated_correctly"]);

type Tone = "pass" | "fail" | "miss" | "error";

export function verdictTone(verdict: EvalVerdict): Tone {
  if (PASSING.has(verdict)) return "pass";
  if (verdict === "wrong" || verdict === "unsupported") return "fail";
  if (verdict === "error") return "error";
  return "miss";
}

const toneClasses: Record<Tone, string> = {
  pass: "border-line-strong text-ink",
  fail: "border-transparent bg-rust text-on-rust",
  miss: "border-transparent bg-rust-soft text-ink",
  error: "border-dashed border-line-strong text-ink-muted",
};

const toneIcons = { pass: CheckIcon, fail: XIcon, miss: MinusIcon, error: WarningCircleIcon };

/** The verdict as a word with an icon, never color alone. */
export function VerdictBadge({ verdict, className }: { verdict: EvalVerdict; className?: string }) {
  const tone = verdictTone(verdict);
  const Icon = toneIcons[tone];
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" weight="bold" />
      {verdictLabel[verdict]}
    </span>
  );
}

export const runStatusLabel: Record<EvalRunStatus, string> = {
  queued: "Waiting to start",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  canceled: "Stopped",
};

export const ACTIVE_RUN = new Set<EvalRunStatus>(["queued", "running"]);

export function RunStatusBadge({ status }: { status: EvalRunStatus }) {
  const active = ACTIVE_RUN.has(status);
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
        status === "failed" ? "border-rust text-rust" : "border-line-strong text-ink",
      )}
    >
      {active ? (
        <span aria-hidden="true" className="spinner text-[0.625rem] text-rust" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full border",
            status === "succeeded" ? "border-ink bg-ink" : "border-line-strong bg-transparent",
          )}
        />
      )}
      {runStatusLabel[status]}
    </span>
  );
}

export const checkLabel: Record<EvalCheck["name"], string> = {
  expected_outcome: "Expected outcome",
  must_include: "Required phrases",
  must_not_include: "Forbidden phrases",
  citations: "Citations",
  gold_retrieved: "Gold document in the top 8",
};

/** "92%", or "Not measured" when there was nothing to measure. */
export function formatPercent(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined) return "Not measured";
  return `${(value * 100).toFixed(digits)}%`;
}

/** "850 ms" or "2.4 s". */
export function formatMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "Not measured";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Model cost from micro dollars: "$0.0042", "$1.20". */
export function formatCost(micros: number | null | undefined) {
  if (micros === null || micros === undefined) return "None";
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
