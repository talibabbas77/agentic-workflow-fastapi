"use client";

import type { Billing, PlanChangePreview } from "@docent/api-client";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api, request } from "@/lib/api/browser";
import { formatDate, formatMoney } from "@/lib/format";
import type { PaidPlan } from "./plan-status";

type Loaded = { plan: PaidPlan; preview: PlanChangePreview };

/**
 * What a plan change costs and why, before the owner commits to it. The server
 * works the figures out (billing/proration.py); this shows them line by line,
 * with Stripe's own invoice preview as the final word on today's charge.
 */
export function PlanChangeDialog({
  billing,
  plan,
  onClose,
  onChanged,
}: {
  billing: Billing;
  /** The plan being considered. Null closes the dialog. */
  plan: PaidPlan | null;
  onClose: () => void;
  onChanged: (billing: Billing, preview: PlanChangePreview) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Keep the last plan so the text does not vanish while the dialog fades out.
  const [last, setLast] = useState(plan);
  if (plan && plan !== last) {
    setLast(plan);
    setLoaded(null);
    setLoadError(null);
    setError(null);
  }
  const target = plan ?? last;

  useEffect(() => {
    if (!plan) return;
    let current = true;
    void request(api.GET("/v1/billing/preview", { params: { query: { plan_id: plan.id } } })).then((result) => {
      if (!current) return;
      if (result.ok) setLoaded({ plan, preview: result.data });
      else setLoadError(result.error.message);
    });
    return () => {
      current = false;
    };
  }, [plan]);

  const preview = loaded && loaded.plan === target ? loaded.preview : null;
  const upgrade = preview?.kind === "upgrade";
  const due = preview ? (preview.stripe_due_now_cents ?? preview.due_now_cents) : 0;
  const starts = preview ? formatDate(preview.effective_at) : null;
  const blocked = !preview || preview.blockers.length > 0 || preview.kind === "same" || !billing.billing_enabled;

  async function confirm() {
    if (!target || !preview) return;
    setPending(true);
    setError(null);
    const result = await request(api.POST("/v1/billing/change", { body: { plan_id: target.id } }));
    setPending(false);
    if (result.ok) onChanged(result.data, preview);
    else setError(result.error.message);
  }

  return (
    <Dialog
      open={plan !== null}
      onClose={onClose}
      size="lg"
      title={!target ? "" : preview && !upgrade ? `Switch to ${target.name}` : `Upgrade to ${target.name}`}
      description={
        !preview
          ? "Working out what this change costs."
          : upgrade
            ? "Starts now. You pay only the difference for the rest of this billing period."
            : `Starts on ${starts}, when the period you paid for ends.`
      }
    >
      <DialogBody className="flex flex-col gap-5">
        {loadError ? (
          <FormAlert>{loadError}</FormAlert>
        ) : !preview ? (
          <PreviewSkeleton />
        ) : (
          <>
            {upgrade ? (
              <Charges preview={preview} renews={billing.current_period_end} />
            ) : (
              <Schedule preview={preview} />
            )}
            <Reasoning lines={preview.explanation} />
            {preview.blockers.length > 0 ? (
              <FormAlert>
                {preview.blockers.length === 1 ? (
                  preview.blockers[0]
                ) : (
                  <ul className="flex list-disc flex-col gap-1 pl-4">
                    {preview.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                )}
              </FormAlert>
            ) : !billing.billing_enabled ? (
              <FormAlert tone="info">Payments are not set up on this server yet, so the change cannot be made.</FormAlert>
            ) : null}
            {error ? <FormAlert>{error}</FormAlert> : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Not now
        </Button>
        <Button loading={pending} disabled={blocked} onClick={confirm}>
          {!preview ? "Continue" : upgrade ? `Upgrade and pay ${formatMoney(due)}` : `Switch on ${starts}`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Today's charge, line by line, adding up to the total. */
function Charges({ preview, renews }: { preview: PlanChangePreview; renews: string | null }) {
  const captionId = useId();
  const stripe = preview.stripe_due_now_cents;
  // Stripe adds tax and rounds per line; show the difference so the lines still add up.
  const adjustment = stripe === null ? 0 : stripe - preview.due_now_cents;
  const due = stripe ?? preview.due_now_cents;
  return (
    <div className="flex flex-col gap-2">
      <table aria-describedby={captionId} className="w-full border-collapse text-base">
        <caption className="sr-only">Charged today</caption>
        <tbody>
          {preview.lines.map((line) => (
            <Row key={line.label} label={line.label} cents={line.amount_cents} />
          ))}
          {adjustment !== 0 ? <Row label="Tax and adjustments on Stripe's invoice" cents={adjustment} /> : null}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="pt-3 text-left font-medium text-ink">
              Due today
            </th>
            <td className="pt-3 text-right text-xl font-semibold tracking-[-0.01em] text-ink tabular-nums">
              {formatMoney(due)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p id={captionId} className="text-sm text-ink-muted">
        Then {formatMoney(preview.next_renewal_cents)} a month
        {renews ? ` from ${formatDate(renews)}, the same renewal date as now` : ""}.
        {stripe !== null ? " The total is Stripe's own invoice preview." : ""}
      </p>
    </div>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <tr className="border-b border-line">
      <th scope="row" className="py-2.5 pr-4 text-left font-normal text-ink-muted">
        {label}
      </th>
      <td className="py-2.5 text-right whitespace-nowrap text-ink tabular-nums">{formatMoney(cents)}</td>
    </tr>
  );
}

/** A downgrade: nothing today, the new price from the renewal. */
function Schedule({ preview }: { preview: PlanChangePreview }) {
  const rows = [
    ["Starts", formatDate(preview.effective_at)],
    ["Due today", formatMoney(0)],
    ["Then", `${formatMoney(preview.next_renewal_cents)} a month`],
  ] as const;
  return (
    <dl className="grid grid-cols-3 divide-x divide-line rounded-md border border-line">
      {rows.map(([term, value]) => (
        <div key={term} className="flex flex-col gap-1 px-4 py-3">
          <dt className="text-sm text-ink-muted">{term}</dt>
          <dd className="font-medium text-ink tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Reasoning({ lines }: { lines: string[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 id={headingId} className="text-sm font-medium text-ink">
        How this is worked out
      </h3>
      <ol className="flex flex-col gap-1.5 text-base text-ink-muted">
        {lines.map((line, index) => (
          <li key={line} className="flex gap-2.5">
            <span aria-hidden="true" className="w-4 shrink-0 text-ink-subtle tabular-nums">
              {index + 1}.
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading the preview">
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-6 w-1/2 self-end" />
      <Skeleton className="mt-2 h-16 w-full" />
    </div>
  );
}
