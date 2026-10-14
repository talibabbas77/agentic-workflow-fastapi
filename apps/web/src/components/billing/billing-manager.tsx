"use client";

import type { Billing, PaidPlanId, Plan } from "@docent/api-client";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { hardNavigate } from "@/lib/navigation";
import { usePoll } from "@/lib/use-poll";
import { CurrentPlan } from "./current-plan";
import { inactiveReason, isSubscribed } from "./plan-status";
import { PlansGrid } from "./plans-grid";
import { UsageMeters } from "./usage-meters";

export type CheckoutReturn = "success" | "canceled" | null;

/** Stripe's webhook usually lands within seconds; after this long, stop asking and say so. */
const CONFIRM_PATIENCE_MS = 30_000;

export function BillingManager({
  initial,
  plans,
  checkout,
}: {
  initial: Billing;
  plans: Plan[] | null;
  /** Where Stripe Checkout sent the owner back from, read once from the URL. */
  checkout: CheckoutReturn;
}) {
  const toast = useToast();
  const [billing, setBilling] = useState(initial);
  const [pending, setPending] = useState<PaidPlanId | "portal" | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  const confirmed = isSubscribed(billing);
  const waiting = checkout === "success" && !confirmed && !gaveUp;

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/billing"));
    if (result.ok) setBilling(result.data);
  }, []);

  // The plan changes when Stripe's webhook arrives, a moment after the redirect back.
  usePoll(waiting, refresh, 3000);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setGaveUp(true), CONFIRM_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  // Drop ?checkout= so a reload does not show the notice again.
  useEffect(() => {
    if (checkout) window.history.replaceState(null, "", window.location.pathname);
  }, [checkout]);

  async function redirect(target: PaidPlanId | "portal") {
    setPending(target);
    const result = await request(
      target === "portal"
        ? api.POST("/v1/billing/portal")
        : api.POST("/v1/billing/checkout", { body: { plan_id: target } }),
    );
    if (result.ok) return hardNavigate(result.data.url);
    setPending(null);
    toast({
      tone: "error",
      title: target === "portal" ? "Could not open billing" : "Could not start checkout",
      description: result.error.message,
    });
    // Someone else may have subscribed meanwhile; show what the server has now.
    if (result.status === 409) await refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Billing" description="Your plan, what this month has used, and what each plan includes." />

      {checkout === "success" ? (
        confirmed ? (
          <FormAlert tone="success">You are on the {billing.plan.name} plan. Thank you.</FormAlert>
        ) : gaveUp ? (
          <FormAlert tone="info">
            Checkout is complete. Stripe has not confirmed the plan yet, which can take a minute. Refresh this page
            shortly.
          </FormAlert>
        ) : (
          <p
            role="status"
            className="fade-in flex items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3.5 py-3 text-base text-ink"
          >
            <span aria-hidden="true" className="spinner text-xs text-rust" />
            Checkout is complete. Waiting for Stripe to confirm your plan.
          </p>
        )
      ) : checkout === "canceled" ? (
        <FormAlert tone="info">Checkout canceled. Nothing changed and nothing was charged.</FormAlert>
      ) : null}

      {billing.active ? null : (
        <div className="fade-in flex items-start gap-3 rounded-md border border-rust/40 bg-rust-soft px-4 py-3.5">
          <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-rust" weight="bold" />
          <div className="flex flex-col gap-1 text-base">
            <p className="font-medium text-ink">Escalate-only mode</p>
            <p className="text-ink-muted">
              {inactiveReason(billing)}, so the agent answers nothing itself. Every message goes to your team as a
              handoff, and the widget asks visitors for an email. Your sources, settings, and conversations are kept.{" "}
              <span className="text-ink">
                {billing.can_manage ? "Choose a plan below to turn answers back on." : "Ask an owner to choose a plan."}
              </span>
            </p>
          </div>
        </div>
      )}

      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <CurrentPlan
          billing={billing}
          managing={pending === "portal"}
          onManage={billing.can_manage && billing.provider === "stripe" ? () => void redirect("portal") : null}
        />
        <UsageMeters billing={billing} />
      </div>

      <PlansGrid
        billing={billing}
        plans={plans}
        pending={pending === "portal" ? null : pending}
        onChoose={(plan) => void redirect(plan)}
      />
    </div>
  );
}
