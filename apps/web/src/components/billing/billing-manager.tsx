"use client";

import type { Billing, PaidPlanId, Plan, PlanChangePreview, RefundStatus } from "@docent/api-client";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import type { FetchOutcome } from "@/lib/api/result";
import { formatDate, formatMoney } from "@/lib/format";
import { hardNavigate } from "@/lib/navigation";
import { usePoll } from "@/lib/use-poll";
import { CancelPlanDialog } from "./cancel-plan-dialog";
import { CurrentPlan, type PlanActions } from "./current-plan";
import { PlanChangeDialog } from "./plan-change-dialog";
import { inactiveReason, isSubscribed, type PaidPlan } from "./plan-status";
import { PlansGrid } from "./plans-grid";
import { RefundDialog } from "./refund-dialog";
import { UsageMeters } from "./usage-meters";

export type CheckoutReturn = "success" | "canceled" | null;

/** Stripe's webhook usually lands within seconds; after this long, stop asking and say so. */
const CONFIRM_PATIENCE_MS = 30_000;

type Open = { kind: "change"; plan: PaidPlan } | { kind: "cancel" } | { kind: "refund" } | null;
/** An upgrade Stripe has accepted; the plan changes when its webhook confirms the payment. */
type Upgrade = { plan: PaidPlan; gaveUp: boolean } | null;

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
  const [busy, setBusy] = useState<"keep" | "resume" | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const [upgrade, setUpgrade] = useState<Upgrade>(null);

  const confirmed = isSubscribed(billing);
  const waiting = checkout === "success" && !confirmed && !gaveUp;
  const upgraded = upgrade !== null && billing.plan.id === upgrade.plan.id;
  const waitingForUpgrade = upgrade !== null && !upgraded && !upgrade.gaveUp;

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/billing"));
    if (result.ok) setBilling(result.data);
  }, []);

  // The plan changes when Stripe's webhook arrives, a moment after checkout or an upgrade.
  usePoll(waiting || waitingForUpgrade, refresh, 3000);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setGaveUp(true), CONFIRM_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  useEffect(() => {
    if (!waitingForUpgrade) return;
    const timer = window.setTimeout(
      () => setUpgrade((current) => (current ? { ...current, gaveUp: true } : current)),
      CONFIRM_PATIENCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [waitingForUpgrade]);

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

  /** Keep the plan or resume it: one request, then the server's billing. */
  async function update(
    kind: "keep" | "resume",
    call: () => Promise<FetchOutcome<Billing>>,
    done: { title: string; description: string },
  ) {
    setBusy(kind);
    const result = await request(call());
    setBusy(null);
    if (result.ok) {
      setBilling(result.data);
      toast({ tone: "success", ...done });
      return;
    }
    toast({ tone: "error", title: "Could not change the plan", description: result.error.message });
    if (result.status === 409) await refresh();
  }

  function changed(next: Billing, preview: PlanChangePreview) {
    if (open?.kind !== "change") return;
    const { plan } = open;
    setOpen(null);
    setBilling(next);
    if (preview.kind === "upgrade") {
      setUpgrade({ plan, gaveUp: false });
      return;
    }
    toast({
      tone: "success",
      title: `Switch to ${plan.name} scheduled`,
      description: `${plan.name} starts on ${formatDate(preview.effective_at)}. Nothing was charged today.`,
    });
  }

  function refunded(refund: RefundStatus) {
    setOpen(null);
    toast({
      tone: "success",
      title: `Refunded ${formatMoney(refund.amount_cents)}`,
      description: "The plan has ended. Stripe returns the money to the card, usually within 5 to 10 business days.",
    });
    void refresh();
  }

  /** Close one dialog. Its native close event lands after the next one may have opened. */
  const close = (kind: NonNullable<Open>["kind"]) => () => setOpen((current) => (current?.kind === kind ? null : current));

  const renews = billing.current_period_end ? formatDate(billing.current_period_end) : null;
  const actions: PlanActions | null = billing.can_manage
    ? {
        busy: pending === "portal" ? "portal" : busy,
        manage: () => void redirect("portal"),
        keep: () =>
          void update("keep", () => api.DELETE("/v1/billing/change"), {
            title: `Keeping ${billing.plan.name}`,
            description: "The switch at renewal is canceled. Nothing else changes.",
          }),
        cancel: () => setOpen({ kind: "cancel" }),
        resume: () =>
          void update("resume", () => api.POST("/v1/billing/resume"), {
            title: "Plan resumed",
            description: renews ? `${billing.plan.name} renews on ${renews} as before.` : "The plan renews as before.",
          }),
        refund: () => setOpen({ kind: "refund" }),
      }
    : null;

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
          <Waiting>Checkout is complete. Waiting for Stripe to confirm your plan.</Waiting>
        )
      ) : checkout === "canceled" ? (
        <FormAlert tone="info">Checkout canceled. Nothing changed and nothing was charged.</FormAlert>
      ) : null}

      {upgrade === null ? null : upgraded ? (
        <FormAlert tone="success">You are on {upgrade.plan.name} now. Its limits apply from today.</FormAlert>
      ) : upgrade.gaveUp ? (
        <FormAlert tone="info">
          Stripe has not confirmed the upgrade yet. If the card needs another step, Stripe emails the invoice to pay.
          The plan stays as it is until the payment goes through.
        </FormAlert>
      ) : (
        <Waiting>Upgrade to {upgrade.plan.name} requested. Waiting for Stripe to confirm the payment.</Waiting>
      )}

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
        <CurrentPlan billing={billing} actions={actions} />
        <UsageMeters billing={billing} />
      </div>

      <PlansGrid
        billing={billing}
        plans={plans}
        pending={pending === "portal" ? null : pending}
        onChoose={(plan) => void redirect(plan)}
        onChange={(plan) => setOpen({ kind: "change", plan })}
      />

      <PlanChangeDialog
        billing={billing}
        plan={open?.kind === "change" ? open.plan : null}
        onClose={close("change")}
        onChanged={changed}
      />
      <CancelPlanDialog
        billing={billing}
        open={open?.kind === "cancel"}
        onClose={close("cancel")}
        onCanceled={(next) => {
          setOpen(null);
          setBilling(next);
          toast({
            tone: "success",
            title: "Plan canceled",
            description: renews
              ? `${next.plan.name} keeps working until ${renews}. Resume any time before then.`
              : "The plan keeps working until the end of this period.",
          });
        }}
        onRefundInstead={() => setOpen({ kind: "refund" })}
      />
      <RefundDialog billing={billing} open={open?.kind === "refund"} onClose={close("refund")} onRefunded={refunded} />
    </div>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="fade-in flex items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3.5 py-3 text-base text-ink"
    >
      <span aria-hidden="true" className="spinner text-xs text-rust" />
      {children}
    </p>
  );
}
