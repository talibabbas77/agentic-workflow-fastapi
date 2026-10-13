import type { Plan } from "@docent/api-client";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { formatPrice } from "@/lib/plans";
import { CONTACT_EMAIL } from "@/lib/site";

/** Shown instead of prices when the plan catalog cannot be loaded. */
export function PlansUnavailable() {
  return (
    <p className="rounded-md border border-line bg-surface px-5 py-4 text-base text-ink-muted">
      Prices could not be loaded just now. Try again in a minute, or write to{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-rust underline underline-offset-[3px]">
        {CONTACT_EMAIL}
      </a>
      .
    </p>
  );
}

function per(plan: Plan) {
  return plan.trial_days ? `for ${plan.trial_days} days` : "per month";
}

/** Full plan cards for the pricing page. */
export function PlanCards({ plans }: { plans: Plan[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((plan) => (
        <li key={plan.id} className="flex flex-col rounded-md border border-line bg-surface p-6">
          <h2 className="text-xl text-ink">{plan.name}</h2>
          <p className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold text-ink tabular-nums">{formatPrice(plan)}</span>
            <span className="text-sm whitespace-nowrap text-ink-muted">{per(plan)}</span>
          </p>
          <p className="mt-3 text-base text-ink-muted lg:min-h-[3lh]">{plan.summary}</p>
          <dl className="mt-5 flex flex-col divide-y divide-line border-y border-line text-base">
            <Row label="AI replies per month" value={formatCount(plan.replies_per_month)} />
            <Row label="Pages of docs" value={formatCount(plan.pages)} />
            <Row label="Widgets" value={formatCount(plan.widgets)} />
            <Row label="Team seats" value={formatCount(plan.seats)} />
          </dl>
          <ul className="mt-5 flex flex-col gap-2 text-base text-ink">
            {plan.anonymous_mode ? <Included>Anonymous visitors</Included> : null}
            {plan.identified_mode ? <Included>Signed-in customers</Included> : null}
            <Included>Hard monthly cap</Included>
          </ul>
          <div className="mt-auto pt-6">
            <ButtonLink href="/signup" variant={plan.trial_days ? "primary" : "secondary"} block>
              Start free trial
              <span className="sr-only">, then {plan.name}</span>
            </ButtonLink>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Included({ children }: { children: string }) {
  return (
    <li className="flex items-center gap-2">
      <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-ink" weight="bold" />
      {children}
    </li>
  );
}

/** A compact plan table for the home page. */
export function PlanSummary({ plans }: { plans: Plan[] }) {
  return (
    <div className="flex flex-col gap-6">
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        {plans.map((plan) => (
          <li key={plan.id} className="flex flex-col gap-1 bg-surface p-5">
            <span className="text-sm text-ink-muted">{plan.name}</span>
            <span className="text-2xl font-semibold text-ink tabular-nums">{formatPrice(plan)}</span>
            <span className="text-sm text-ink-muted tabular-nums">
              {per(plan)}, {formatCount(plan.replies_per_month)} replies
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/pricing"
        className="self-start rounded-sm font-medium text-rust underline decoration-rust/30 underline-offset-[3px] hover:text-rust-hover"
      >
        See what each plan includes
      </Link>
    </div>
  );
}
