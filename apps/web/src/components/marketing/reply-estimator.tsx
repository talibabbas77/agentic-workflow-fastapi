"use client";

import type { Plan } from "@docent/api-client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { centsPerReply, count, monthlyPlans, priceLabel, recommendPlan } from "./plan-math";

const MIN = 100;
const MAX = 30_000;
const STEPS = 1000;

/** Slider position (0 to 1000, log scale) to a rounded number of replies. */
function toReplies(position: number) {
  const raw = MIN * Math.pow(MAX / MIN, position / STEPS);
  const step = raw < 500 ? 25 : raw < 2_000 ? 50 : raw < 10_000 ? 250 : 500;
  return Math.min(MAX, Math.max(MIN, Math.round(raw / step) * step));
}

function toPosition(replies: number) {
  const clamped = Math.min(MAX, Math.max(MIN, replies));
  return Math.round((Math.log(clamped / MIN) / Math.log(MAX / MIN)) * STEPS);
}

const ticks = [100, 1_000, 10_000, 30_000];
const picks = [500, 3_000, 10_000, 25_000];

/**
 * "How many AI replies do you expect?" A log-scale slider and a number field.
 * It names the smallest plan whose cap covers the estimate, shows how full
 * each plan would be, and marks the matching plan card on the page.
 */
export function ReplyEstimator({
  plans,
  initial,
  contactEmail,
}: {
  plans: Plan[];
  initial: number;
  contactEmail: string;
}) {
  const [replies, setReplies] = useState(initial);
  const [text, setText] = useState(String(initial));
  const id = useId();
  const questionId = `${id}-question`;
  const options = monthlyPlans(plans);
  const fit = recommendPlan(plans, replies);
  const top = options.at(-1);
  const position = toPosition(replies);
  const share = position / STEPS;

  // Mark the matching plan card, which is server-rendered elsewhere on the page.
  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-plan-card]").forEach((card) => {
      card.toggleAttribute("data-fit", card.dataset.planCard === fit?.id);
    });
  }, [fit?.id]);

  function fromNumber(value: string) {
    setText(value);
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) setReplies(n);
  }

  function fromSlider(value: string) {
    const n = toReplies(Number(value));
    setReplies(n);
    setText(String(n));
  }

  let message: ReactNode;
  let detail: string | null = null;
  if (fit) {
    const spare = fit.replies_per_month - replies;
    message =
      spare === 0
        ? `${fit.name} covers exactly ${count(replies)} replies a month.`
        : `${fit.name} covers ${count(replies)} replies a month, with ${count(spare)} to spare.`;
    const cents = centsPerReply(fit);
    detail = `${priceLabel(fit)} a month${cents ? `, about ${cents} cents a reply if you use them all` : ""}. At the cap the widget becomes a contact form, never an overage bill.`;
  } else if (top) {
    message = (
      <>
        {count(replies)} replies a month is more than {top.name} includes. Write to us at{" "}
        <a href={`mailto:${contactEmail}`} className="text-rust underline underline-offset-[3px] hover:text-rust-hover">
          {contactEmail}
        </a>{" "}
        and we will talk about a larger plan.
      </>
    );
  } else {
    message = (
      <>
        Write to us at{" "}
        <a href={`mailto:${contactEmail}`} className="text-rust underline underline-offset-[3px] hover:text-rust-hover">
          {contactEmail}
        </a>{" "}
        and we will help you pick a plan.
      </>
    );
  }

  return (
    <div className="mk-reveal grid overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-2">
      <div className="flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <label id={questionId} htmlFor={`${id}-number`} className="text-lg font-semibold tracking-[-0.02em] text-ink">
            How many AI replies do you expect each month?
          </label>
          <p className="text-sm text-ink-muted">
            One reply is one message the agent writes. If you are not sure, start from the number of support
            conversations you had last month.
          </p>
        </div>
        <div className="flex items-baseline gap-3">
          <input
            id={`${id}-number`}
            type="number"
            inputMode="numeric"
            min={1}
            step={50}
            value={text}
            onChange={(event) => fromNumber(event.target.value)}
            aria-describedby={`${id}-result`}
            className="h-12 w-36 [appearance:textfield] rounded-md border border-line-strong bg-paper px-3 text-2xl font-semibold tracking-[-0.02em] text-ink tabular-nums transition-colors duration-150 hover:border-ink-subtle [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-base text-ink-muted">replies a month</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="relative">
            <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2" />
            <div
              aria-hidden="true"
              className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-rust"
              style={{ width: `calc(${share * 100}% + ${0.625 - 1.25 * share}rem)` }}
            />
            <input
              type="range"
              min={0}
              max={STEPS}
              step={5}
              value={position}
              onChange={(event) => fromSlider(event.target.value)}
              aria-labelledby={questionId}
              aria-valuetext={`${count(replies)} replies a month`}
              className="mk-range relative"
            />
          </div>
          <div aria-hidden="true" className="relative h-4 text-xs text-ink-muted tabular-nums">
            {ticks.map((tick, i) => (
              <span
                key={tick}
                className={cn(
                  "absolute",
                  i === 0 ? "left-0" : i === ticks.length - 1 ? "right-0" : "-translate-x-1/2",
                  // 10,000 sits too close to 30,000 on a phone.
                  tick === 10_000 && "max-sm:hidden",
                )}
                style={i === 0 || i === ticks.length - 1 ? undefined : { left: `${(toPosition(tick) / STEPS) * 100}%` }}
              >
                {count(tick)}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-5">
          <span className="mr-1 text-sm text-ink-muted">Try</span>
          {picks.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={replies === n}
              onClick={() => {
                setReplies(n);
                setText(String(n));
              }}
              className="rounded-full border border-line-strong px-3 py-1 text-sm text-ink tabular-nums transition-colors duration-150 hover:bg-surface-2 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper"
            >
              {count(n)}
              <span className="sr-only"> replies a month</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-5 border-t border-line bg-paper p-6 sm:p-8 lg:border-t-0 lg:border-l">
        <div id={`${id}-result`} role="status" data-testid="estimate-result" className="flex min-h-[4.5rem] flex-col gap-1.5">
          <p className="text-md font-medium text-ink">{message}</p>
          {detail ? <p className="text-sm text-ink-muted">{detail}</p> : null}
        </div>
        <ul className="flex flex-col gap-2" aria-label="How full each plan would be">
          {options.map((plan) => {
            const used = replies / plan.replies_per_month;
            const over = used > 1;
            const chosen = plan.id === fit?.id;
            return (
              <li
                key={plan.id}
                className={cn(
                  "rounded-md border px-4 py-3 transition-colors duration-200",
                  chosen ? "border-ink bg-surface" : "border-line",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className={cn("font-medium", chosen ? "text-ink" : "text-ink-muted")}>{plan.name}</span>
                  <span className="text-ink-muted tabular-nums">
                    {count(plan.replies_per_month)} replies, {priceLabel(plan)} a month
                  </span>
                </div>
                <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-300 ease-out",
                      over ? "bg-rust" : chosen ? "bg-ink" : "bg-line-strong",
                    )}
                    style={{ width: `${Math.min(1, used) * 100}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">
                  {over
                    ? `Too small: ${count(replies - plan.replies_per_month)} over its cap`
                    : chosen
                      ? `Fits, ${Math.round(used * 100)}% of the cap`
                      : `Fits, more than you need`}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
