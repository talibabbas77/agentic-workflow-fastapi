import type { Billing, UsageMeter } from "@docent/api-client";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/cn";
import { formatCount, formatDate } from "@/lib/format";

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Rules between the smaller meters: below each on phones, beside each from sm up. */
const rule = "border-b border-line sm:border-r sm:border-b-0";

/** The share of a cap where owners get a warning email, as the replies meter marks it. */
const WARN_AT = 0.8;

export function UsageMeters({ billing }: { billing: Billing }) {
  const { usage } = billing;
  const { replies } = usage;
  const share = replies.limit > 0 ? replies.used / replies.limit : 0;
  const resets = formatDate(usage.period_end);

  let repliesNote: ReactNode = "Answers, clarifying questions, and handoff messages count. Greetings do not.";
  if (!billing.active) {
    repliesNote = "The agent writes no replies in escalate-only mode.";
  } else if (share >= 1) {
    repliesNote = <Warning>All replies for this month are used. Until {resets}, every message goes to your team.</Warning>;
  } else if (share >= WARN_AT) {
    repliesNote = (
      <Warning>
        {Math.floor(share * 100)} percent used. At 100 percent, every message goes to your team until {resets}.
      </Warning>
    );
  }

  return (
    <Card aria-labelledby="usage-heading" className="min-w-0">
      <CardHeader className="gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <CardTitle id="usage-heading">Usage this month</CardTitle>
        <CardDescription className="text-sm">
          {monthFormat.format(new Date(usage.period_start))}. Resets on {resets}.
        </CardDescription>
      </CardHeader>
      <dl className="grid sm:grid-cols-3">
        <Meter
          label="AI replies"
          meter={replies}
          warn={billing.active && share >= WARN_AT}
          note={repliesNote}
          marks
          className="border-b border-line sm:col-span-3"
        >
          AI replies used
        </Meter>
        <Meter label="Pages of docs" meter={usage.documents} note="A file or a crawled page counts as one." className={rule}>
          Pages of docs used
        </Meter>
        <Meter label="Widgets" meter={usage.widgets} note="Each with its own sites and keys." className={rule}>
          Widgets used
        </Meter>
        <Meter label="Seats" meter={usage.seats} note="Members plus open invitations.">
          Seats used
        </Meter>
      </dl>
    </Card>
  );
}

function Meter({
  label,
  meter,
  note,
  warn = false,
  marks = false,
  className,
  children,
}: {
  label: string;
  meter: UsageMeter;
  note: ReactNode;
  warn?: boolean;
  /** Ticks at 80 and 100 percent, where the warning email and escalate-only mode start. */
  marks?: boolean;
  className?: string;
  /** The bar's accessible name. */
  children: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 px-6 py-5", className)}>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="flex flex-col gap-3">
        <span className="tabular-nums">
          <span className="text-2xl font-semibold text-ink">{formatCount(meter.used)}</span>{" "}
          <span className="text-sm text-ink-muted">
            {/* No allowance at all, as in escalate-only mode: a count, not a meter. */}
            {meter.limit > 0 ? `of ${formatCount(meter.limit)}` : "used"}
          </span>
        </span>
        {meter.limit === 0 ? null : marks ? (
          <div className="flex flex-col gap-1.5">
            <div className="relative">
              <ProgressBar value={meter.used} max={meter.limit} label={children} warn={warn} />
              <span aria-hidden="true" className="absolute top-1/2 left-[80%] h-3 w-px -translate-y-1/2 bg-ink-muted" />
              <span aria-hidden="true" className="absolute top-1/2 right-0 h-3 w-px -translate-y-1/2 bg-ink-muted" />
            </div>
            <div aria-hidden="true" className="relative h-4 text-xs text-ink-muted tabular-nums">
              <span className="absolute left-[80%] -translate-x-1/2">80%</span>
              <span className="absolute right-0">100%</span>
            </div>
          </div>
        ) : (
          <ProgressBar value={meter.used} max={meter.limit} label={children} />
        )}
        <p className="text-sm text-ink-muted">
          {!marks && meter.limit > 0 && meter.used >= meter.limit ? "All in use. A bigger plan adds more." : note}
        </p>
      </dd>
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-ink">
      <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-rust" weight="bold" />
      <span>{children}</span>
    </span>
  );
}
