"use client";

import type { Billing } from "@docent/api-client";
import {
  ArrowSquareOutIcon,
  CalendarDotsIcon,
  CheckCircleIcon,
  ClockIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { textLinkClasses } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { isSubscribed, monthlyPrice, planState } from "./plan-status";

/** What an owner can do with the plan from this card. */
export type PlanActions = {
  /** The action whose request is in flight. */
  busy: "portal" | "keep" | "resume" | null;
  /** Opens Stripe's portal for the card and invoices. */
  manage: () => void;
  /** Drops a downgrade that is waiting for the renewal. */
  keep: () => void;
  cancel: () => void;
  resume: () => void;
  refund: () => void;
};

export function CurrentPlan({
  billing,
  actions,
}: {
  billing: Billing;
  /** Null for members who are not owners. */
  actions: PlanActions | null;
}) {
  const now = useNow();
  const { plan, scheduled_plan: scheduled } = billing;
  const state = planState(billing, now);
  const Icon = state.warn ? WarningCircleIcon : billing.status === "trialing" ? ClockIcon : CheckCircleIcon;
  const onTrial = billing.provider === "manual" && billing.status === "trialing" && billing.active;
  const subscribed = isSubscribed(billing);
  const enabled = billing.billing_enabled;

  return (
    <Card aria-labelledby="plan-heading" className="flex min-w-0 flex-col">
      <CardHeader>
        <CardTitle id="plan-heading">Current plan</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-semibold tracking-[-0.02em] text-ink">{plan.name}</p>
          <p className="text-base text-ink-muted">
            {plan.price_usd_month > 0 ? (
              <>
                <span className="font-medium text-ink tabular-nums">{monthlyPrice(plan)}</span> a month
              </>
            ) : plan.trial_days ? (
              `Free for ${plan.trial_days} days`
            ) : (
              "Free"
            )}
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <Icon
            aria-hidden="true"
            className={cn("mt-0.5 size-4.5 shrink-0", state.warn ? "text-rust" : "text-ink")}
            weight={state.warn ? "bold" : "regular"}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-medium text-ink" data-testid="plan-status">
              {state.label}
            </p>
            {state.detail ? <p className="text-sm text-ink-muted">{state.detail}</p> : null}
          </div>
        </div>
        {scheduled ? (
          <div
            data-testid="scheduled-change"
            className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 px-4 py-3"
          >
            <div className="flex items-start gap-2.5">
              <CalendarDotsIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-ink" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="font-medium text-ink">
                  Switches to {scheduled.name}
                  {billing.scheduled_change_at ? ` on ${formatDate(billing.scheduled_change_at)}` : " at renewal"}
                </p>
                <p className="text-sm text-ink-muted">
                  {plan.name} and its limits stay until then. Nothing is charged today.
                </p>
              </div>
            </div>
            {actions ? (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                loading={actions.busy === "keep"}
                disabled={!enabled}
                onClick={actions.keep}
              >
                Keep {plan.name}
              </Button>
            ) : null}
          </div>
        ) : null}
        {actions && billing.provider === "stripe" ? (
          <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={actions.busy === "portal"}
                disabled={!enabled}
                onClick={actions.manage}
                icon={<ArrowSquareOutIcon aria-hidden="true" className="size-4" />}
              >
                Manage billing
              </Button>
              {subscribed && billing.cancel_at_period_end ? (
                <Button
                  variant="secondary"
                  loading={actions.busy === "resume"}
                  disabled={!enabled}
                  onClick={actions.resume}
                >
                  Resume plan
                </Button>
              ) : subscribed ? (
                <Button variant="ghost" onClick={actions.cancel}>
                  Cancel plan
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-ink-muted">Update the card and download invoices on Stripe.</p>
            {billing.refund_until ? (
              <p className="text-sm text-ink-muted">
                Money-back guarantee until {formatDate(billing.refund_until)}.{" "}
                <button type="button" className={textLinkClasses} onClick={actions.refund}>
                  Request a refund
                </button>
              </p>
            ) : null}
          </div>
        ) : onTrial ? (
          <p className="mt-auto border-t border-line pt-4 text-sm text-ink-muted">
            When the trial ends, the agent stops answering and hands every message to your team until a plan is
            chosen. Nothing is deleted.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
