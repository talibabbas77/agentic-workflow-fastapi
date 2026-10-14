"use client";

import type { Billing, TopupPack } from "@docent/api-client";
import { InfoIcon, PlusIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount, formatDate, formatMoney, plural } from "@/lib/format";
import { centsPerReply, monthName, repliesShare } from "./topup-math";

/** From this share of the month's replies, the billing page offers top-up packs. */
export const TOPUP_FROM = 0.8;

/** Whether the card shows: a paid plan that is on, and the month 80 percent used or more. */
export function showTopups(billing: Billing) {
  return billing.active && billing.plan.topup_packs.length > 0 && repliesShare(billing) >= TOPUP_FROM;
}

/**
 * "Need more replies this month?": the current plan's packs, each with the cap it
 * leads to and its price. Choosing one opens the preview; nothing is charged here.
 */
export function TopupCard({ billing, onChoose }: { billing: Billing; onChoose: (pack: TopupPack) => void }) {
  const { replies } = billing.usage;
  const month = monthName(billing.usage.period_start);
  const resets = formatDate(billing.usage.period_end);
  const share = repliesShare(billing);
  const bought = billing.topups.bought;
  const used =
    share >= 1
      ? `All ${formatCount(replies.limit)} replies for ${month} are used, so every message goes to your team.`
      : `${Math.floor(share * 100)} percent of ${month}'s ${formatCount(replies.limit)} replies are used.`;

  let note: ReactNode = null;
  if (!billing.can_manage) note = "Ask an owner to add replies.";
  else if (!billing.billing_enabled) note = "Payments are not set up on this server yet.";

  return (
    <Card aria-labelledby="topup-heading" className="fade-in min-w-0">
      <CardHeader>
        <CardTitle id="topup-heading">Need more replies this month?</CardTitle>
        <CardDescription>
          {used} A top-up pack adds replies to {month} only, at the {billing.plan.name} plan&apos;s own price of{" "}
          {centsPerReply(billing.plan)} cents a reply. It ends on {resets}, used or not, and never renews.
        </CardDescription>
      </CardHeader>
      <ul className="grid sm:grid-cols-2">
        {billing.plan.topup_packs.map((pack, index) => (
          <li
            key={pack.id}
            className={
              index === 0
                ? "flex flex-col gap-4 border-b border-line px-6 py-5 sm:border-r sm:border-b-0"
                : "flex flex-col gap-4 px-6 py-5"
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tracking-[-0.02em] text-ink tabular-nums">
                  +{formatCount(pack.replies)}
                </span>
                <span className="text-sm text-ink-muted">replies</span>
              </p>
              <p className="text-lg font-semibold tracking-[-0.01em] text-ink tabular-nums">
                {formatMoney(pack.price_cents)}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 text-sm">
              <dt className="text-ink-muted">New cap for {month}</dt>
              <dd className="text-right font-medium text-ink tabular-nums">
                {formatCount(replies.limit + pack.replies)}
              </dd>
              <dt className="text-ink-muted">Renews</dt>
              <dd className="text-right text-ink">Never</dd>
            </dl>
            {billing.can_manage ? (
              <Button
                variant={index === 0 ? "primary" : "secondary"}
                block
                icon={<PlusIcon aria-hidden="true" className="size-4" weight="bold" />}
                disabled={!billing.billing_enabled}
                onClick={() => onChoose(pack)}
              >
                Add {formatCount(pack.replies)} replies
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {note || bought.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line px-6 py-4 text-sm text-ink-muted">
          {note ? (
            <p className="flex items-start gap-2 text-base text-ink">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-ink-muted" />
              {note}
            </p>
          ) : null}
          {bought.length > 0 ? (
            <p>
              Added in {month}:{" "}
              {bought
                .map((t) => `${formatCount(t.replies)} ${plural(t.replies, "reply", "replies")} on ${formatDate(t.created_at)}`)
                .join(", ")}
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
