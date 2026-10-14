import type { Plan } from "@docent/api-client";
import {
  ChatTextIcon,
  CheckIcon,
  EnvelopeSimpleIcon,
  InfoIcon,
  MinusIcon,
  PlusCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { CONTACT_EMAIL } from "@/lib/site";
import { centsPerReply, count, packPrice, periodLabel, priceLabel } from "./plan-math";

/** The plan marked as a good fit for most teams. A marketing choice, not a price. */
export const FEATURED_PLAN = "growth";

/** Shown instead of prices when the plan catalog cannot be loaded. */
export function PlansUnavailable() {
  return (
    <p className="rounded-lg border border-line bg-surface px-5 py-4 text-base text-ink-muted">
      Prices could not be loaded just now. Try again in a minute, or write to{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-rust underline underline-offset-[3px]">
        {CONTACT_EMAIL}
      </a>
      .
    </p>
  );
}

function plural(n: number, one: string, many: string) {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/**
 * The plan cards. Each card is a subgrid over six shared rows, so names,
 * prices, summaries, reply boxes, feature lists, and buttons line up across
 * every card in a row. `fit` marks the plan the reply estimator recommends.
 */
export function PlanCards({ plans, fit }: { plans: Plan[]; fit?: string | null }) {
  return (
    <ul className="grid gap-x-4 gap-y-10 pt-3 md:grid-cols-2 lg:grid-cols-4">
      {plans.map((plan) => {
        const featured = plan.id === FEATURED_PLAN;
        const cents = centsPerReply(plan);
        return (
          <li
            key={plan.id}
            data-plan-card={plan.id}
            data-fit={fit === plan.id ? "" : undefined}
            className={cn(
              "group/plan relative row-span-6 grid grid-rows-subgrid gap-0 rounded-lg border bg-surface p-6 transition-colors duration-200",
              featured ? "border-rust" : "border-line data-[fit]:border-ink",
            )}
          >
            {featured ? (
              <p className="absolute -top-3 left-6 rounded-full bg-rust px-2.5 py-0.5 text-xs font-medium text-on-rust">
                Good fit for growing teams
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg text-ink">{plan.name}</h3>
              <span className="hidden items-center gap-1 rounded-full border border-ink px-2 py-0.5 text-xs font-medium text-ink group-data-[fit]/plan:inline-flex">
                <CheckIcon aria-hidden="true" className="size-3" weight="bold" />
                Fits your estimate
              </span>
            </div>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-[-0.02em] text-ink tabular-nums">{priceLabel(plan)}</span>
              <span className="text-sm whitespace-nowrap text-ink-muted">{periodLabel(plan)}</span>
            </p>
            <p className="mt-3 text-base text-ink-muted">{plan.summary}</p>
            <div className="mt-5 flex flex-col gap-1 rounded-md border border-line bg-paper px-4 py-3.5">
              <p className="flex flex-col">
                <span className="text-xl font-semibold tracking-[-0.02em] text-ink tabular-nums">
                  {count(plan.replies_per_month)}
                </span>
                <span className="text-sm font-medium text-ink">
                  {plan.trial_days ? "AI replies in the trial" : "AI replies a month"}
                </span>
              </p>
              <p className="text-sm text-ink-muted">
                {cents
                  ? `About ${cents} cents a reply if you use them all`
                  : "Answers, clarifying questions, and handoffs all count"}
              </p>
            </div>
            <ul className="mt-5 flex flex-col gap-2.5 border-t border-line pt-5 text-base text-ink">
              <Included>{plural(plan.pages, "page of docs", "pages of docs")}</Included>
              <Included>{plural(plan.widgets, "widget", "widgets")}</Included>
              <Included>{plural(plan.seats, "team seat", "team seats")}</Included>
              {plan.anonymous_mode ? <Included>Anonymous visitors</Included> : null}
              {plan.identified_mode ? <Included>Signed-in customers</Included> : null}
              <Included>Hard monthly cap</Included>
            </ul>
            <div className="mt-6 self-end">
              <ButtonLink href="/signup" variant={featured ? "primary" : "secondary"} block>
                Start free trial
                <span className="sr-only">, then {plan.name}</span>
              </ButtonLink>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Included({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckIcon aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-ink" weight="bold" />
      <span>{children}</span>
    </li>
  );
}

/** What an AI reply is, right next to the prices. */
export function ReplyDefinition() {
  const items: { title: string; body: string }[] = [
    {
      title: "Counts as one reply",
      body: "Each message the agent writes: an answer, a clarifying question, or the message that hands the conversation to your team.",
    },
    {
      title: "Does not count",
      body: "The customer's own messages, replies to greetings and thanks, and emails your team sends from the inbox.",
    },
    {
      title: "Checked as it happens",
      body: "A reply is reserved before the agent writes it, so many conversations at once cannot run past your cap.",
    },
  ];
  return (
    <div className="mk-reveal rounded-lg border border-line bg-surface">
      <p className="flex items-center gap-2 border-b border-line px-6 py-3.5 text-md font-semibold tracking-[-0.02em] text-ink">
        <InfoIcon aria-hidden="true" className="size-4.5 text-rust" />
        What is an AI reply?
      </p>
      <dl className="grid md:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.title}
            className="flex flex-col gap-1 border-line px-6 py-5 not-first:border-t md:not-first:border-t-0 md:not-first:border-l"
          >
            <dt className="text-base font-medium text-ink">{item.title}</dt>
            <dd className="text-base text-ink-muted">{item.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The cap, drawn as a meter from 0 to 100 percent with the two events marked. */
export function CapExplainer() {
  return (
    <div className="mk-reveal grid gap-8 rounded-lg border border-line bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-12">
      <div className="flex flex-col gap-3">
        <h3 className="text-lg text-ink">What happens at the cap</h3>
        <p className="text-base text-ink-muted">
          At the cap the widget becomes a contact form, so customers still reach your team, and you are never billed
          overage.
        </p>
        <p className="flex items-start gap-2.5 border-t border-line pt-3 text-base text-ink-muted">
          <PlusCircleIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-rust" />
          <span>
            <span className="font-medium text-ink">Busy month?</span> An owner can add a top-up pack at the
            plan&apos;s own price per reply. It counts for that month only and is never bought automatically.
          </span>
        </p>
      </div>
      <div className="flex flex-col gap-6">
        <div aria-hidden="true" className="relative pt-6">
          <span className="absolute top-0 left-0 text-xs text-ink-muted tabular-nums">0%</span>
          <span className="absolute top-0 left-[80%] -translate-x-1/2 text-xs font-medium text-ink tabular-nums">
            80%
          </span>
          <span className="absolute top-0 right-0 text-xs font-medium text-ink tabular-nums">100%</span>
          <div className="flex h-3 overflow-hidden rounded-full border border-line-strong">
            <div className="w-[80%] bg-surface-2" />
            <div className="flex-1 border-l border-rust bg-rust-soft" />
          </div>
          <span className="absolute right-0 bottom-[-0.25rem] h-5 w-0.5 rounded-full bg-rust" />
        </div>
        <dl className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="flex items-center gap-2.5 text-base font-medium text-ink">
              <EnvelopeSimpleIcon aria-hidden="true" className="size-4.5 shrink-0 text-ink" />
              At 80 percent
            </dt>
            <dd className="pl-7 text-sm text-ink-muted">
              Owners and admins get an email, and the admin app shows a banner. Nothing changes for customers.
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="flex items-center gap-2.5 text-base font-medium text-ink">
              <ChatTextIcon aria-hidden="true" className="size-4.5 shrink-0 text-rust" />
              At 100 percent
            </dt>
            <dd className="pl-7 text-sm text-ink-muted">
              The widget shows a short message and a contact form, and every message lands in your inbox. Owners get
              an email.
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

type Row = { label: string; help: string; value: (plan: Plan) => ReactNode };

function yes(on: boolean) {
  return on ? (
    <span className="inline-flex items-center gap-1.5">
      <CheckIcon aria-hidden="true" className="size-4 text-ink" weight="bold" />
      <span className="sr-only">Included</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-ink-muted">
      <MinusIcon aria-hidden="true" className="size-4" />
      <span className="sr-only">Not included</span>
    </span>
  );
}

const rows: Row[] = [
  {
    label: "AI replies",
    help: "Answers, clarifying questions, and handoff messages the agent writes.",
    value: (plan) => (plan.trial_days ? `${count(plan.replies_per_month)} in ${plan.trial_days} days` : `${count(plan.replies_per_month)} a month`),
  },
  {
    label: "Pages of docs",
    help: "How much you can teach the agent. At the limit, sources you have keep working.",
    value: (plan) => count(plan.pages),
  },
  {
    label: "Widgets",
    help: "Each with its own allowed domains and signing keys.",
    value: (plan) => count(plan.widgets),
  },
  {
    label: "Team seats",
    help: "People who use the admin app and reply to handoffs.",
    value: (plan) => count(plan.seats),
  },
  {
    label: "Anonymous visitors",
    help: "Answers from public docs for people who are not signed in.",
    value: (plan) => yes(plan.anonymous_mode),
  },
  {
    label: "Signed-in customers",
    help: "Answers that use the customer's plan, from a token your server signs.",
    value: (plan) => yes(plan.identified_mode),
  },
  {
    label: "Answers with citations",
    help: "Each answer links to the passage it used.",
    value: () => yes(true),
  },
  {
    label: "Handoffs with a summary",
    help: "To your inbox. Your team replies by email.",
    value: () => yes(true),
  },
  {
    label: "At the cap",
    help: "What customers see when the month's replies are used.",
    value: () => "Contact form, no overage",
  },
  {
    label: "Top-up packs",
    help: "Extra replies for one busy month, at the plan's price per reply. Bought by hand, never renewed.",
    value: (plan) =>
      plan.topup_packs.length === 0 ? (
        <span className="text-ink-muted">Paid plans only</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {plan.topup_packs.map((pack) => (
            <li key={pack.id} className="whitespace-nowrap">
              +{count(pack.replies)} for {packPrice(pack.price_cents)}
            </li>
          ))}
        </ul>
      ),
  },
];

/** Every plan side by side. The plan header sticks under the site header on wide screens. */
export function ComparisonTable({ plans }: { plans: Plan[] }) {
  // relative: the sr-only labels inside are absolutely positioned and must stay inside this scroller.
  return (
    <div className="mk-reveal relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 lg:overflow-visible">
      <table className="w-full min-w-[46rem] border-collapse text-left text-base">
        <caption className="sr-only">Every plan compared</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 w-[30%] border-b border-line-strong bg-paper py-4 pr-6 align-bottom text-sm font-medium text-ink-muted lg:top-16"
            >
              Plan
            </th>
            {plans.map((plan) => (
              <th
                key={plan.id}
                scope="col"
                className="z-10 border-b border-line-strong bg-paper px-4 py-4 align-bottom font-normal lg:sticky lg:top-16"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-md font-semibold tracking-[-0.02em] text-ink">
                    {plan.name}
                    {plan.id === FEATURED_PLAN ? (
                      <span aria-hidden="true" className="mk-ribbon inline-block h-3.5 w-2" />
                    ) : null}
                  </span>
                  <span className="text-sm text-ink-muted tabular-nums">
                    {priceLabel(plan)} {periodLabel(plan)}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line">
              <th scope="row" className="sticky left-0 z-10 bg-paper py-4 pr-6 align-top font-normal">
                <span className="block font-medium text-ink">{row.label}</span>
                <span className="mt-0.5 block text-sm text-ink-muted">{row.help}</span>
              </th>
              {plans.map((plan) => (
                <td key={plan.id} className="px-4 py-4 align-top text-ink tabular-nums">
                  {row.value(plan)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
