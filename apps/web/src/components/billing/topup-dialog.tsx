"use client";

import type { Billing, TopupPack } from "@docent/api-client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { api, request } from "@/lib/api/browser";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { hardNavigate } from "@/lib/navigation";
import { centsPerReply, monthName, repliesShare } from "./topup-math";

/**
 * The cap a pack leads to and what it costs, before the owner goes to Stripe.
 * Nothing changes here: the replies arrive with Stripe's webhook once the
 * payment goes through.
 */
export function TopupDialog({
  billing,
  pack,
  biggerPlan,
  onClose,
}: {
  billing: Billing;
  /** The pack being considered. Null closes the dialog. */
  pack: TopupPack | null;
  /** A plan with more replies exists, so the dialog can point at it. */
  biggerPlan: boolean;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the last pack so the text does not vanish while the dialog fades out.
  const [last, setLast] = useState(pack);
  if (pack && pack !== last) {
    setLast(pack);
    setError(null);
  }
  const shown = pack ?? last;
  const month = monthName(billing.usage.period_start);

  async function pay() {
    if (!shown) return;
    setPending(true);
    setError(null);
    const result = await request(api.POST("/v1/billing/topups/checkout", { body: { pack_id: shown.id } }));
    if (result.ok) return hardNavigate(result.data.url);
    setPending(false);
    setError(result.error.message);
  }

  return (
    <Dialog
      open={pack !== null}
      onClose={onClose}
      size="lg"
      title={shown ? `Add ${formatCount(shown.replies)} replies to ${month}` : ""}
      description="Paid once through Stripe. The cap goes up as soon as Stripe confirms the payment."
    >
      <DialogBody className="flex flex-col gap-5">
        {shown ? <Preview billing={billing} pack={shown} month={month} biggerPlan={biggerPlan} /> : null}
        {!billing.billing_enabled ? (
          <FormAlert tone="info">Payments are not set up on this server yet, so a pack cannot be bought.</FormAlert>
        ) : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Not now
        </Button>
        <Button loading={pending} disabled={!shown || !billing.billing_enabled} onClick={pay}>
          {shown ? `Pay ${formatMoney(shown.price_cents)} with Stripe` : "Continue"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function Preview({
  billing,
  pack,
  month,
  biggerPlan,
}: {
  billing: Billing;
  pack: TopupPack;
  month: string;
  biggerPlan: boolean;
}) {
  const captionId = useId();
  const headingId = useId();
  const { replies } = billing.usage;
  const ends = formatDate(billing.usage.period_end);
  const fromPlan = replies.limit - billing.topups.replies;
  const atCap = repliesShare(billing) >= 1;
  const rows: [string, string][] = [
    [
      `${month} cap now`,
      billing.topups.replies > 0
        ? `${formatCount(replies.limit)} (${formatCount(fromPlan)} from the plan, ${formatCount(billing.topups.replies)} from top-ups)`
        : formatCount(replies.limit),
    ],
    ["Used so far", formatCount(replies.used)],
    ["This pack", `+${formatCount(pack.replies)}`],
  ];
  const reasons = [
    `${formatCount(pack.replies)} replies at the ${billing.plan.name} plan's price per reply, ${centsPerReply(billing.plan)} cents, the same as the plan itself.`,
    `They count for ${month} only and end on ${ends}, used or not. Nothing renews and nothing is charged again.`,
    atCap
      ? "The agent starts answering again as soon as Stripe confirms the payment, usually within seconds."
      : "The agent keeps answering past the old cap once Stripe confirms the payment, usually within seconds.",
    ...(biggerPlan ? ["Need more every month? A bigger plan costs less per reply."] : []),
  ];
  return (
    <>
      <div className="flex flex-col gap-2">
        <table aria-describedby={captionId} className="w-full border-collapse text-base">
          <caption className="sr-only">The new cap</caption>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-b border-line">
                <th scope="row" className="py-2.5 pr-4 text-left font-normal text-ink-muted">
                  {label}
                </th>
                <td className="py-2.5 text-right text-ink tabular-nums">{value}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-b border-line">
              <th scope="row" className="py-3 text-left font-medium text-ink">
                New cap for {month}
              </th>
              <td className="py-3 text-right text-xl font-semibold tracking-[-0.01em] text-ink tabular-nums">
                {formatCount(replies.limit + pack.replies)}
              </td>
            </tr>
            <tr>
              <th scope="row" className="pt-3 text-left font-medium text-ink">
                Due today
              </th>
              <td className="pt-3 text-right text-xl font-semibold tracking-[-0.01em] text-ink tabular-nums">
                {formatMoney(pack.price_cents)}
              </td>
            </tr>
          </tfoot>
        </table>
        <p id={captionId} className="text-sm text-ink-muted">
          Charged once. The plan&apos;s monthly price does not change.
        </p>
      </div>
      <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 id={headingId} className="text-sm font-medium text-ink">
          How this works
        </h3>
        <ol className="flex flex-col gap-1.5 text-base text-ink-muted">
          {reasons.map((line, index) => (
            <li key={line} className="flex gap-2.5">
              <span aria-hidden="true" className="w-4 shrink-0 text-ink-subtle tabular-nums">
                {index + 1}.
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
