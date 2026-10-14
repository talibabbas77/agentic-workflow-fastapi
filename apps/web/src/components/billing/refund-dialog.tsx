"use client";

import type { Billing, RefundStatus } from "@docent/api-client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api, request } from "@/lib/api/browser";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * The 14 day money-back guarantee: everything paid comes back and the plan ends
 * now. The amount comes from Stripe, so an upgrade charge in the window counts.
 */
export function RefundDialog({
  billing,
  open,
  onClose,
  onRefunded,
}: {
  billing: Billing;
  open: boolean;
  onClose: () => void;
  onRefunded: (refund: RefundStatus) => void;
}) {
  const [offer, setOffer] = useState<RefundStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setOffer(null);
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let current = true;
    void request(api.GET("/v1/billing/refund")).then((result) => {
      if (!current) return;
      if (result.ok) setOffer(result.data);
      else setError(result.error.message);
    });
    return () => {
      current = false;
    };
  }, [open]);

  async function refund() {
    setPending(true);
    setError(null);
    const result = await request(api.POST("/v1/billing/refund"));
    setPending(false);
    if (result.ok) onRefunded(result.data);
    else setError(result.error.message);
  }

  const amount = offer?.eligible ? formatMoney(offer.amount_cents) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Request a refund"
      description="The money-back guarantee returns everything paid in the first 14 days."
    >
      <DialogBody className="flex flex-col gap-4">
        {!offer && !error ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Loading the refund">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : offer ? (
          <>
            {amount ? (
              <div className="flex items-baseline justify-between gap-4 rounded-md border border-line px-4 py-3">
                <span className="text-base text-ink-muted">Refunded to the card on file</span>
                <span className="text-xl font-semibold tracking-[-0.01em] text-ink tabular-nums">{amount}</span>
              </div>
            ) : null}
            {offer.eligible && offer.refund_until ? (
              <p className="text-base text-ink">Available until {formatDate(offer.refund_until)}.</p>
            ) : (
              <p className="text-base text-ink">{offer.reason}</p>
            )}
            {offer.eligible ? (
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base text-ink-muted">
                <li>
                  The {billing.plan.name} plan ends right away. The agent stops answering and every message goes to
                  your team. Sources, settings, and conversations are kept.
                </li>
                <li>Stripe returns the money to the card, which usually takes 5 to 10 business days to show.</li>
                <li>A workspace can be refunded once. Choosing a plan later starts a new subscription.</li>
              </ul>
            ) : null}
          </>
        ) : null}
        {offer?.eligible && !billing.billing_enabled ? (
          <FormAlert tone="info">Payments are not set up on this server yet, so the refund cannot be made.</FormAlert>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Not now
        </Button>
        <Button
          variant="danger"
          loading={pending}
          disabled={!offer?.eligible || !billing.billing_enabled}
          onClick={refund}
        >
          {amount ? `Refund ${amount} and end the plan` : "Refund and end the plan"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
