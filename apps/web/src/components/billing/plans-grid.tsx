"use client";

import type { Billing, PaidPlanId, Plan } from "@docent/api-client";
import { CheckIcon, InfoIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatCount, plural } from "@/lib/format";
import { isSubscribed, monthlyPrice } from "./plan-status";

const isPaid = (plan: Plan): plan is Plan & { id: PaidPlanId } => plan.price_usd_month > 0;

/**
 * The paid plans, with the current one marked. Owners choose a plan through
 * Stripe Checkout; once subscribed, changes go through the billing portal.
 */
export function PlansGrid({
  billing,
  plans,
  pending,
  onChoose,
}: {
  billing: Billing;
  /** Null when the catalog could not be loaded. */
  plans: Plan[] | null;
  /** The plan whose checkout is starting. */
  pending: PaidPlanId | null;
  onChoose: (plan: PaidPlanId) => void;
}) {
  const subscribed = isSubscribed(billing);
  const choosing = billing.can_manage && !subscribed;

  let note: ReactNode = null;
  if (!billing.can_manage) note = "Ask an owner to change the plan.";
  else if (!billing.billing_enabled) note = "Payments are not set up on this server yet.";
  else if (subscribed) note = "To switch plans, open Manage billing. An upgrade applies right away.";

  return (
    <section aria-labelledby="plans-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="plans-heading" className="text-xl text-ink">
          Plans
        </h2>
        <p className="text-sm text-ink-muted">
          Every plan has a hard monthly cap on AI replies, so the bill never surprises you.
        </p>
      </div>
      {note ? (
        <p className="flex items-start gap-2 text-base text-ink">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-ink-muted" />
          {note}
        </p>
      ) : null}
      {plans === null ? (
        <p className="rounded-md border border-line bg-surface px-5 py-4 text-base text-ink-muted">
          Plans could not be loaded just now. Refresh the page in a minute.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-3">
          {plans.filter(isPaid).map((plan) => {
            const current = billing.active && billing.plan.id === plan.id;
            return (
              <li
                key={plan.id}
                className={cn(
                  "flex flex-col rounded-md border bg-surface p-6",
                  current ? "border-ink" : "border-line",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg text-ink">{plan.name}</h3>
                  {current ? <Badge tone="accent">Current plan</Badge> : null}
                </div>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-3xl font-semibold tracking-[-0.02em] text-ink tabular-nums">
                    {monthlyPrice(plan)}
                  </span>
                  <span className="text-sm text-ink-muted">a month</span>
                </p>
                <p className="mt-2 text-base text-ink-muted">{plan.summary}</p>
                <ul className="mt-5 flex flex-col gap-2 border-t border-line pt-5 text-base text-ink">
                  <Included>
                    <span className="font-medium tabular-nums">{formatCount(plan.replies_per_month)}</span> AI replies a
                    month
                  </Included>
                  <Included>{counted(plan.pages, "page of docs", "pages of docs")}</Included>
                  <Included>{counted(plan.widgets, "widget")}</Included>
                  <Included>{counted(plan.seats, "seat")}</Included>
                </ul>
                {choosing && !current ? (
                  <Button
                    variant="secondary"
                    block
                    className="mt-6"
                    loading={pending === plan.id}
                    disabled={!billing.billing_enabled || (pending !== null && pending !== plan.id)}
                    onClick={() => onChoose(plan.id)}
                  >
                    Choose plan<span className="sr-only"> {plan.name}</span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function counted(n: number, singular: string, pluralForm?: string) {
  return `${formatCount(n)} ${plural(n, singular, pluralForm)}`;
}

function Included({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckIcon aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-ink" weight="bold" />
      <span>{children}</span>
    </li>
  );
}
