"use client";

import type { Billing } from "@docent/api-client";
import { ArrowSquareOutIcon, CheckCircleIcon, ClockIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/use-now";
import { monthlyPrice, planState } from "./plan-status";

export function CurrentPlan({
  billing,
  managing,
  onManage,
}: {
  billing: Billing;
  /** The portal link is being made. */
  managing: boolean;
  /** Opens Stripe's portal. Null hides the button: not an owner, or never paid through Stripe. */
  onManage: (() => void) | null;
}) {
  const now = useNow();
  const { plan } = billing;
  const state = planState(billing, now);
  const Icon = state.warn ? WarningCircleIcon : billing.status === "trialing" ? ClockIcon : CheckCircleIcon;
  const onTrial = billing.provider === "manual" && billing.status === "trialing" && billing.active;

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
        {onManage ? (
          <div className="mt-auto flex flex-col gap-2 pt-1">
            <Button
              variant="secondary"
              loading={managing}
              disabled={!billing.billing_enabled}
              onClick={onManage}
              icon={<ArrowSquareOutIcon aria-hidden="true" className="size-4" />}
              className="self-start"
            >
              Manage billing
            </Button>
            <p className="text-sm text-ink-muted">Change the plan, update the card, or download invoices on Stripe.</p>
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
