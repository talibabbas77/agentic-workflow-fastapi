import {
  FunnelSimpleIcon,
  HeadsetIcon,
  QuotesIcon,
  RobotIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Bubble, ExampleTag } from "./chat-bits";

const question = "Do you have a discount for nonprofits?";

/** "A typical support bot" next to Docent, answering the same question. */
export function ProblemContrast() {
  return (
    <div className="flex flex-col gap-10">
      <div className="mk-reveal grid gap-4 md:grid-cols-2">
        <Card
          icon={<RobotIcon />}
          title="A typical support bot"
          verdict="Guesses"
          next="The customer quotes the discount to your billing team. Your team either honors a promise nobody made or walks it back."
        >
          <Bubble from="visitor">{question}</Bubble>
          <div className="flex flex-col gap-2">
            <Bubble from="agent">
              Yes!{" "}
              <mark className="bg-transparent text-ink underline decoration-rust decoration-wavy decoration-1 underline-offset-4">
                Nonprofits get 50 percent off any yearly plan. Send your registration number to billing and the discount
                applies to your next invoice.
              </mark>
            </Bubble>
            <p className="inline-flex items-center gap-1.5 self-start rounded-md border border-rust/40 bg-rust-soft px-2 py-1 text-sm text-ink">
              <WarningIcon aria-hidden="true" className="size-4 text-rust" />
              Not in your docs. They never mention a nonprofit discount.
            </p>
          </div>
        </Card>
        <Card
          icon={<SealCheckIcon />}
          title="Docent"
          verdict="Hands off"
          strong
          next="Your team gets the question and a summary in the inbox, and replies by email with the real answer."
        >
          <Bubble from="visitor">{question}</Bubble>
          <div className="flex flex-col gap-2">
            <Bubble from="agent">
              I could not find this in our help articles, so I passed it to the Lumen Notes team. They will reply by
              email.
            </Bubble>
            <p className="inline-flex items-center gap-1.5 self-start rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink">
              <HeadsetIcon aria-hidden="true" className="size-4 text-rust" />
              Handed to the Lumen Notes team, with a summary
            </p>
          </div>
        </Card>
      </div>

      <div className="mk-reveal flex flex-col gap-8">
        <p className="max-w-[60ch] text-lg text-ink">
          A guess costs more than a handoff. Docent answers only when a passage in your docs supports it, and passes
          everything else to a person.
        </p>
        <ul className="grid gap-x-10 gap-y-6 border-t border-line pt-8 md:grid-cols-3">
          <Point icon={<FunnelSimpleIcon />} title="Answers need a source">
            Docent searches your docs before it writes. If no passage clears the evidence threshold, it does not answer
            from the docs, and the question goes to your team.
          </Point>
          <Point icon={<QuotesIcon />} title="Every answer shows its page">
            Each sentence that uses a passage carries a marker, and the chip under the answer opens that passage and
            links to the page.
          </Point>
          <Point icon={<ShieldCheckIcon />} title="Checked before it is shown">
            A reply without a valid citation, or on a restricted topic, becomes a handoff. Links to anything but the
            cited pages are removed.
          </Point>
        </ul>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  verdict,
  strong = false,
  next,
  children,
}: {
  icon: ReactNode;
  title: string;
  verdict: string;
  strong?: boolean;
  next: string;
  children: ReactNode;
}) {
  return (
    <article
      className={cn("flex flex-col rounded-lg border bg-surface", strong ? "border-line-strong" : "border-line")}
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span aria-hidden="true" className={cn("text-lg", strong ? "text-rust" : "text-ink-muted")}>
          {icon}
        </span>
        <h3 className="text-md text-ink">{title}</h3>
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 text-xs font-medium",
            strong ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-muted",
          )}
        >
          {verdict}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-3 bg-paper px-5 py-5">{children}</div>
      <footer className="flex items-start gap-3 rounded-b-lg border-t border-line px-5 py-4">
        <span className="shrink-0 text-sm font-medium text-ink">Then</span>
        <p className="text-sm text-ink-muted">{next}</p>
        <ExampleTag className="ml-auto shrink-0" />
      </footer>
    </article>
  );
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-md text-ink">
        <span aria-hidden="true" className="text-lg text-rust">
          {icon}
        </span>
        {title}
      </h3>
      <p className="text-base text-ink-muted">{children}</p>
    </li>
  );
}
