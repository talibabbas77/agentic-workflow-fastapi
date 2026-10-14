import type { HandoffReason, HandoffStatus, Priority } from "@docent/api-client";
import { cn } from "@/lib/cn";

export const statuses: { value: HandoffStatus; label: string; short: string }[] = [
  { value: "open", label: "Open", short: "Open" },
  { value: "assigned", label: "Assigned", short: "Assigned" },
  { value: "waiting", label: "Waiting on customer", short: "Waiting" },
  { value: "resolved", label: "Resolved", short: "Resolved" },
];

export const statusLabel = Object.fromEntries(statuses.map((s) => [s.value, s.label])) as Record<
  HandoffStatus,
  string
>;

/** Why the agent handed off, in plain words. */
export const reasons: { value: HandoffReason; label: string }[] = [
  { value: "user_requested", label: "Asked for a person" },
  { value: "no_source", label: "No supporting source" },
  { value: "low_confidence", label: "Low confidence" },
  { value: "restricted_topic", label: "Restricted topic" },
  { value: "repeated_failure", label: "Could not help" },
  { value: "cap_reached", label: "Monthly replies used up" },
];

export const reasonLabel = Object.fromEntries(reasons.map((r) => [r.value, r.label])) as Record<
  HandoffReason,
  string
>;

export const priorityOptions: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const priorityLabel = Object.fromEntries(priorityOptions.map((p) => [p.value, p.label])) as Record<
  Priority,
  string
>;

const statusDot: Record<HandoffStatus, string> = {
  open: "border-rust bg-rust",
  assigned: "border-ink bg-ink",
  waiting: "border-ink-subtle bg-transparent",
  resolved: "border-line-strong bg-line-strong",
};

/** Status as a word with a shape beside it, never color alone. */
export function StatusBadge({ status, className }: { status: HandoffStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-sm border border-line-strong px-1.5 text-xs font-medium whitespace-nowrap text-ink",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full border", statusDot[status])} />
      {statusLabel[status]}
    </span>
  );
}

/** Only high and urgent stand out; low and normal stay quiet. */
export function PriorityBadge({ priority, quiet = true }: { priority: Priority; quiet?: boolean }) {
  if (quiet && (priority === "low" || priority === "normal")) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
        priority === "urgent"
          ? "border-transparent bg-rust text-on-rust"
          : priority === "high"
            ? "border-transparent bg-rust-soft text-ink"
            : "border-line-strong text-ink-muted",
      )}
    >
      {priorityLabel[priority]}
      <span className="sr-only"> priority</span>
    </span>
  );
}

/** The dot that marks something new since you last opened it. */
export function UnreadDot({ unread }: { unread: boolean }) {
  return (
    <span className="inline-flex size-2.5 shrink-0 items-center justify-center">
      {unread ? (
        <>
          <span aria-hidden="true" className="size-2 rounded-full bg-rust" />
          <span className="sr-only">Unread. </span>
        </>
      ) : null}
    </span>
  );
}
