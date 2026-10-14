"use client";

import type { AdminRedis } from "@docent/api-client";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatCount, formatDate, formatDateTime } from "@/lib/format";

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

/** The first day of the month after this one, when local-only mode ends. */
function monthEnd(month: string) {
  const start = new Date(month);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
}

const modes: Record<AdminRedis["status"], { label: string; tone: "neutral" | "accent" | "outline" }> = {
  ok: { label: "Shared through Redis", tone: "neutral" },
  degraded: { label: "Redis unreachable", tone: "accent" },
  local_only: { label: "Local-only", tone: "accent" },
  disabled: { label: "Redis not configured", tone: "outline" },
};

/**
 * Docent's own Redis commands this month against the budget it keeps under the
 * provider's free tier: the count, the 80 and 90 percent marks, the alerts sent,
 * and the mode the app is in (ARCHITECTURE section 7).
 */
export function RedisBudget({ redis }: { redis: AdminRedis }) {
  const month = monthFormat.format(new Date(redis.month));
  const share = redis.budget > 0 ? redis.commands / redis.budget : 0;
  const mode = modes[redis.status];
  const warn = share * 100 >= Math.min(...redis.alert_percents);
  const ends = formatDate(monthEnd(redis.month));
  const sent = [
    { percent: 80, at: redis.alerted_80_at },
    { percent: 90, at: redis.alerted_90_at },
  ].flatMap(({ percent, at }) => (at ? [`${percent} percent on ${formatDate(at)}`] : []));

  let explain: string;
  if (redis.status === "local_only") {
    const since = redis.local_only_since ? ` on ${formatDate(redis.local_only_since)}` : "";
    explain = `The app stopped sending Redis commands${since} and uses its in-process cache and rate limits until ${ends}.`;
  } else if (redis.status === "disabled") {
    explain = "REDIS_URL is not set, so every API process keeps its own cache and rate limits. Nothing is counted.";
  } else if (redis.status === "degraded") {
    explain = "Recent commands failed, so this process uses its in-process cache and rate limits until Redis answers again.";
  } else {
    explain = `At ${redis.local_only_percent} percent the app stops sending commands until ${ends}, so the provider's limit is never reached.`;
  }

  return (
    <Card aria-labelledby="redis-heading" className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id="redis-heading">Redis commands in {month}</CardTitle>
          <Badge tone={mode.tone} data-testid="redis-mode">
            {mode.label}
          </Badge>
        </div>
        <CardDescription>
          The budget Docent keeps under the Redis plan&apos;s monthly limit. Platform admins get an email at{" "}
          {redis.alert_percents.join(" and ")} percent.
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-3 px-6 py-5">
        <p className="tabular-nums">
          <span className="text-2xl font-semibold tracking-[-0.02em] text-ink">{formatCount(redis.commands)}</span>{" "}
          <span className="text-sm text-ink-muted">
            of {formatCount(redis.budget)}, {Math.floor(share * 100)} percent
          </span>
        </p>
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <ProgressBar value={redis.commands} max={redis.budget} label="Redis commands used" warn={warn} />
            {redis.alert_percents.map((percent) => (
              <span
                key={percent}
                aria-hidden="true"
                className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink-muted"
                style={{ left: `${percent}%` }}
              />
            ))}
          </div>
          <div aria-hidden="true" className="relative h-4 text-xs text-ink-muted tabular-nums">
            {redis.alert_percents.map((percent) => (
              <span key={percent} className="absolute -translate-x-1/2" style={{ left: `${percent}%` }}>
                {percent}%
              </span>
            ))}
          </div>
        </div>
        <p className="flex items-start gap-2 text-sm text-ink-muted">
          {redis.status === "ok" || redis.status === "disabled" ? (
            <CheckCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
          ) : (
            <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rust" weight="bold" />
          )}
          <span>{explain}</span>
        </p>
      </div>
      <dl className="grid grid-cols-2 border-t border-line text-sm">
        <div className="flex flex-col gap-0.5 border-r border-line px-6 py-3.5">
          <dt className="text-ink-muted">Alerts sent</dt>
          <dd className="text-ink">
            {sent.length === 0
              ? "None this month"
              : sent.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5 px-6 py-3.5">
          <dt className="text-ink-muted">Last counted</dt>
          <dd className="text-ink">{redis.counted_at ? formatDateTime(redis.counted_at) : "Not yet this month"}</dd>
        </div>
      </dl>
    </Card>
  );
}
