"use client";

import type { Billing } from "@docent/api-client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { textLinkClasses } from "@/components/ui/text-link";
import { api, request } from "@/lib/api/browser";
import { formatDate } from "@/lib/format";

/**
 * Cancel at the end of the paid period. The owner keeps what they paid for and
 * can resume until then; inside the money-back window, a refund is offered too.
 */
export function CancelPlanDialog({
  billing,
  open,
  onClose,
  onCanceled,
  onRefundInstead,
}: {
  billing: Billing;
  open: boolean;
  onClose: () => void;
  onCanceled: (billing: Billing) => void;
  onRefundInstead: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }

  const name = billing.plan.name;
  const ends = billing.current_period_end ? formatDate(billing.current_period_end) : null;
  const until = ends ? `until ${ends}` : "until the end of this billing period";

  async function cancel() {
    setPending(true);
    setError(null);
    const result = await request(api.POST("/v1/billing/cancel"));
    setPending(false);
    if (result.ok) onCanceled(result.data);
    else setError(result.error.message);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Cancel the ${name} plan?`}
      description={`${name} keeps working ${until}, the end of the period you paid for.`}
    >
      <DialogBody className="flex flex-col gap-4">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base text-ink-muted">
          <li>
            After that, the agent stops answering and hands every message to your team. Sources, settings, and
            conversations are kept.
          </li>
          <li>You can resume the plan any time {ends ? `before ${ends}` : "before then"}, with nothing to pay.</li>
          {billing.scheduled_plan ? (
            <li>The switch to {billing.scheduled_plan.name} that was waiting is dropped.</li>
          ) : null}
          <li>The rest of this period is not refunded, since the plan keeps working until it ends.</li>
        </ul>
        {billing.refund_until ? (
          <p className="rounded-md border border-line bg-surface-2 px-3.5 py-3 text-base text-ink">
            You are inside the 14 day money-back window until {formatDate(billing.refund_until)}. To end the plan now
            and get everything back instead,{" "}
            <button type="button" className={textLinkClasses} onClick={onRefundInstead}>
              request a refund
            </button>
            .
          </p>
        ) : null}
        {!billing.billing_enabled ? (
          <FormAlert tone="info">
            Payments are not set up on this server yet, so the plan cannot be canceled here.
          </FormAlert>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Keep {name}
        </Button>
        <Button variant="danger" loading={pending} disabled={!billing.billing_enabled} onClick={cancel}>
          Cancel plan
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
