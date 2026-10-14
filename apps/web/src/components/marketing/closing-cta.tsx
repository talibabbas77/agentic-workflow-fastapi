import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getPlans } from "@/lib/plans";
import { count } from "./plan-math";
import { container } from "./section";

// The secondary button on the band: paper on ink in light mode, the usual surface look in dark mode.
const bandButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-base font-medium whitespace-nowrap select-none " +
  "transition-[color,background-color,border-color,transform] duration-150 ease-out active:translate-y-px " +
  "border-paper/35 text-paper hover:border-paper/60 hover:bg-paper/10 " +
  "dark:border-line-strong dark:bg-surface dark:text-ink dark:hover:border-ink-subtle dark:hover:bg-surface-2";

/**
 * The closing call to action: the one inverted band on the site. Ink with paper
 * text in light mode; in dark mode a lifted surface with a strong border, which
 * reads calmer than a bright paper band on a dark page.
 */
export async function ClosingCta({
  title = "Teach the agent your docs and try it on your own site",
  body = "Add your docs during the trial and test it with real questions before you pay.",
}: {
  title?: string;
  body?: string;
}) {
  const plans = await getPlans();
  const trial = plans?.find((plan) => plan.trial_days);
  const steps = [
    {
      title: "Start the trial",
      body: trial
        ? `${trial.trial_days} days with ${count(trial.replies_per_month)} AI replies, on every feature.`
        : "Every feature, with a small reply cap.",
    },
    { title: "Add your docs", body: "Upload files, or add a page or your help center's sitemap." },
    { title: "Paste one script tag", body: "Ask it the questions your customers ask, before anyone else sees it." },
  ];

  return (
    <section
      aria-labelledby="start-heading"
      className="border-t border-line bg-ink text-paper dark:border-y dark:border-line-strong dark:bg-surface-2 dark:text-ink"
    >
      <div className={cn(container, "relative py-20 sm:py-24")}>
        <span aria-hidden="true" className="mk-ribbon absolute top-0 right-6 h-14 w-7 sm:right-10 sm:h-16 sm:w-8" />
        <div className="grid gap-12 lg:grid-cols-12 lg:items-end">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <h2 id="start-heading" className="max-w-[20ch] text-3xl sm:text-4xl">
              {title}
            </h2>
            <p className="max-w-[52ch] text-md text-paper/75 dark:text-ink-muted">{body}</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <ButtonLink href="/signup">Start free trial</ButtonLink>
              <Link href="/docs" className={bandButton}>
                Read the install guide
              </Link>
            </div>
          </div>
          <ol className="flex flex-col border-t border-paper/20 lg:col-span-5 dark:border-line-strong">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-4 border-b border-paper/20 py-4 dark:border-line-strong"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-paper/40 text-xs font-medium tabular-nums dark:border-line-strong"
                >
                  {index + 1}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-base font-medium">{step.title}</span>
                  <span className="text-sm text-paper/75 dark:text-ink-muted">{step.body}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
