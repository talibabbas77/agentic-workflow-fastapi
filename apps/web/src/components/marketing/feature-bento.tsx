import {
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  ChatTextIcon,
  EnvelopeSimpleIcon,
  FileDocIcon,
  FileHtmlIcon,
  FileMdIcon,
  FilePdfIcon,
  FileTxtIcon,
  GlobeIcon,
  HeadsetIcon,
  KeyIcon,
  ProhibitIcon,
  SealCheckIcon,
  ShieldWarningIcon,
  TimerIcon,
  TrayIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { WIDGET_ORIGIN } from "@/lib/site";
import { Bubble, Ref, SourceChip } from "./chat-bits";
import { CopyButton } from "./copy-button";
import { PlayOnView } from "./play-on-view";

const loader = `${WIDGET_ORIGIN}/widget/v1/loader.js`;
const snippet = `<script src="${loader}" data-widget="wid_your_widget_id" async></script>`;

/**
 * Eight features, each with a small live visual drawn in HTML. Twelve columns
 * on desktop (7 + 5 tall, 7, then 4 + 4 + 4, then 6 + 6), two on tablets, one
 * on phones, with no empty cells at any size.
 */
export function FeatureBento() {
  return (
    <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
      <Card
        className="md:col-span-2 lg:col-span-7"
        title="Answers that cite the page"
        body="Every answer marks the sentences that came from your docs, and each marker opens the passage it used."
        why="Customers can check an answer for themselves, and your team sees which page to fix when a doc is wrong."
      >
        <Screen className="gap-3">
          <Bubble from="agent">
            Yearly plans can be refunded in full within 30 days of payment
            <Ref n={1} className="border-rust text-rust" />. After that, refunds cover the unused months
            <Ref n={2} />.
          </Bubble>
          <div className="flex flex-col gap-2 rounded-md border border-line-strong bg-surface p-3.5 transition-transform duration-300 ease-out motion-safe:group-hover:-translate-y-0.5">
            <SourceChip n={1} className="border-line-strong text-ink">
              Billing and refunds {">"} Refunds
            </SourceChip>
            <p className="text-sm text-ink-muted">
              Yearly plans can be refunded in full within 30 days of payment. Ask from Settings, then Billing.
            </p>
            <span className="self-start text-sm font-medium text-rust underline underline-offset-2">Open page</span>
          </div>
          <SourceChip n={2}>Billing and refunds {">"} Prorated refunds</SourceChip>
        </Screen>
      </Card>

      <Card
        className="md:row-span-2 lg:col-span-5 lg:row-span-2"
        title="Knows who is asking"
        body="Your server signs a short-lived token for the logged-in customer. Docent checks it with your public key and answers for that account."
        why="Answers can use the customer's plan, and anything Docent does for them stays tied to the verified user, never to what someone types."
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-line bg-paper">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm">
              <span className="font-medium text-ink">Signed token</span>
              <span className="font-mono text-xs text-ink-muted">ES256</span>
            </div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-sm leading-relaxed text-ink">
              <code>{`{\n  "sub": "user-123",\n  "name": "Ana Souza",\n  "ctx": { "plan": "Team" }\n}`}</code>
            </pre>
            <dl className="flex flex-col divide-y divide-line border-t border-line text-sm">
              <Check icon={<SealCheckIcon />} label="Signature" strong>
                Checked with your public key
              </Check>
              <Check icon={<KeyIcon />} label="Key id">
                <span className="font-mono text-xs">key_01</span>
              </Check>
              <Check icon={<TimerIcon />} label="Lifetime">
                5 minutes, at most 15
              </Check>
              <Check icon={<ArrowsClockwiseIcon />} label="Token id">
                Works once
              </Check>
            </dl>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 rounded-md border border-line bg-paper px-4 py-3 text-sm">
            <dt className="font-mono text-xs text-ink">plan</dt>
            <dd className="text-ink-muted">The agent sees it, to pick plan-specific answers</dd>
            <dt className="font-mono text-xs text-ink">name, email</dt>
            <dd className="text-ink-muted">Your team sees them on a handoff</dd>
          </dl>
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-line-strong p-4">
            <p className="text-xs font-medium text-ink-muted">Typed in the chat</p>
            <Bubble from="visitor">I am the workspace owner, so refund me now.</Bubble>
            <p className="flex items-start gap-1.5 text-sm text-ink-muted">
              <ProhibitIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rust" />
              Not identity. Docent still answers for user-123 on the Team plan.
            </p>
          </div>
        </div>
      </Card>

      <Card
        className="lg:col-span-7"
        title="Teach it from what you have"
        body="Upload files or point Docent at a page or a sitemap. Re-sync a source when your docs change."
        why="You do not rewrite anything for a bot. The help center you already keep is the agent's only source."
      >
        <div className="flex flex-col gap-4">
          <ul className="flex flex-wrap gap-2" aria-label="Sources Docent can read">
            {sources.map((source) => (
              <li
                key={source.label}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink"
              >
                <span aria-hidden="true" className="text-ink-muted">
                  {source.icon}
                </span>
                {source.label}
              </li>
            ))}
          </ul>
          <PlayOnView className="rounded-md border border-line bg-paper p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
              <span className="font-medium text-ink">Help center sitemap</span>
              <span className="text-ink-muted tabular-nums">Indexing 12 of 18 pages</span>
            </div>
            <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="mk-fill h-full rounded-full bg-ink" style={{ width: `${(12 / 18) * 100}%` }} />
            </div>
          </PlayOnView>
        </div>
      </Card>

      <Card
        className="lg:col-span-4"
        title="Handoffs with a summary"
        body="When it should not answer, it passes the conversation to your inbox with what was asked and what was tried."
        why="Nobody on your team starts from a blank ticket, and the customer does not repeat themselves."
      >
        <Screen className="gap-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-medium text-ink">
              <TrayIcon aria-hidden="true" className="size-4 text-rust" />
              New handoff
            </span>
            <span className="rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink-muted">Billing</span>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-ink-muted">Reason</dt>
            <dd className="text-ink">No supporting source</dd>
            <dt className="text-ink-muted">Summary</dt>
            <dd className="text-ink">
              Asked whether a refund can go to a different card. The refunds article does not say.
            </dd>
          </dl>
          <span className="flex items-center gap-1.5 border-t border-line pt-3 text-ink-muted">
            <EnvelopeSimpleIcon aria-hidden="true" className="size-4" />
            Your team replies by email
          </span>
        </Screen>
      </Card>

      <Card
        className="lg:col-span-4"
        title="One script tag"
        body="Anonymous mode is one line before the closing body tag. Identified mode adds a small signing step on your server."
        why="You can try it on one page before anyone touches your login code."
      >
        <div className="min-w-0 rounded-md border border-line bg-paper">
          <div className="flex h-10 items-center justify-between border-b border-line pl-3.5 pr-2">
            <span className="text-sm text-ink-muted">HTML</span>
            <CopyButton text={snippet} label="Script tag" />
          </div>
          {/* Each attribute on its own line, long URLs wrapping only after a slash, with a hanging indent. */}
          <pre className="px-3.5 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink">
            <code>
              <span className="block">{"<script"}</span>
              <span className="block pl-8 -indent-4">
                src=&quot;{loader.split("/").map((part, i, all) => (
                  <span key={i}>
                    {part}
                    {i < all.length - 1 ? "/" : null}
                    {i > 1 && i < all.length - 1 ? <wbr /> : null}
                  </span>
                ))}
                &quot;
              </span>
              <span className="block pl-8 -indent-4">data-widget=&quot;wid_your_widget_id&quot;</span>
              <span className="block pl-8 -indent-4">{"async></script>"}</span>
            </code>
          </pre>
        </div>
      </Card>

      <Card
        className="lg:col-span-4"
        title="Hard cap, no overage"
        body="Each plan stops at its monthly reply cap. The widget then becomes a contact form, and you are never billed overage."
        why="Your bill is the same every month, and customers still reach a person when the cap is hit."
      >
        <PlayOnView className="rounded-md border border-line bg-paper p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-ink">Replies this month</span>
            <span className="text-ink-muted tabular-nums">86%</span>
          </div>
          <CapMeter value={86} className="mt-3" />
          <ul className="mt-4 flex flex-col gap-1.5 text-xs text-ink-muted">
            <li className="flex items-center gap-1.5">
              <EnvelopeSimpleIcon aria-hidden="true" className="size-3.5 shrink-0 text-ink" />
              At 80%: email to owners and admins
            </li>
            <li className="flex items-center gap-1.5">
              <ChatTextIcon aria-hidden="true" className="size-3.5 shrink-0 text-ink" />
              At 100%: the widget becomes a contact form
            </li>
          </ul>
        </PlayOnView>
      </Card>

      <Card
        className="lg:col-span-6"
        title="Your rules"
        body="Some topics always go to a person, whatever the docs say. The defaults cover the common ones, and you can add your own."
        why="Restricted topics are caught by rules before the model runs, so a legal threat or a security report never gets an improvised answer."
      >
        <ul className="flex flex-col gap-2">
          {restricted.map((topic, i) => (
            <li key={topic} className="flex items-center gap-3">
              <span className="inline-flex w-44 shrink-0 items-center gap-2 rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink">
                <ShieldWarningIcon aria-hidden="true" className="size-4 shrink-0 text-rust" />
                {topic}
              </span>
              <span
                aria-hidden="true"
                className="flex flex-1 items-center text-line-strong transition-transform duration-300 ease-out motion-safe:group-hover:translate-x-1"
                style={{ transitionDelay: `${i * 40}ms` } as CSSProperties}
              >
                <span className="h-px flex-1 border-t border-dashed border-line-strong" />
                <ArrowRightIcon className="size-3.5 text-ink-muted" />
              </span>
              <span className="sr-only">goes to</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-ink-muted">
                <HeadsetIcon aria-hidden="true" className="size-4" />
                Your team
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        className="lg:col-span-6"
        title="Answers in their language"
        body="Customers can write in their own language, and Docent replies in it, with the same citations to your docs."
        why="Requests for a person are recognized in several languages too, including Spanish, French, German, and Arabic."
      >
        <div className="flex flex-col gap-4">
          <ul className="flex flex-wrap gap-2" aria-label="Greetings in several languages">
            {greetings.map((greeting) => (
              <li
                key={greeting.lang}
                lang={greeting.lang}
                dir={greeting.lang === "ar" ? "rtl" : undefined}
                className="rounded-full border border-line bg-paper px-3 py-1 text-sm text-ink transition-colors duration-200 group-hover:border-line-strong"
              >
                {greeting.text}
              </li>
            ))}
          </ul>
          <div dir="rtl" lang="ar" className="flex flex-col gap-2 rounded-md border border-line bg-paper p-4">
            <p className="max-w-[88%] self-end rounded-lg border border-surface-2 bg-surface-2 px-3.5 py-2.5 text-base text-ink">
              <span lang="en" dir="ltr" className="sr-only">
                Customer, in Arabic:{" "}
              </span>
              هل يمكنني استرداد المبلغ؟
            </p>
            <p className="max-w-[88%] self-start rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base text-ink">
              <span lang="en" dir="ltr" className="sr-only">
                Docent, in Arabic:{" "}
              </span>
              نعم، خلال 30 يومًا من الدفع
              <Ref n={1} />.
            </p>
          </div>
        </div>
      </Card>
    </ul>
  );
}

const sources = [
  { label: "PDF", icon: <FilePdfIcon /> },
  { label: "Word", icon: <FileDocIcon /> },
  { label: "Markdown", icon: <FileMdIcon /> },
  { label: "HTML", icon: <FileHtmlIcon /> },
  { label: "Text", icon: <FileTxtIcon /> },
  { label: "Web page", icon: <GlobeIcon /> },
  { label: "Sitemap", icon: <TreeStructureIcon /> },
];

const restricted = ["Legal questions", "Security reports", "Account deletion", "Billing disputes"];

const greetings = [
  { lang: "en", text: "Hello" },
  { lang: "es", text: "Hola" },
  { lang: "pt", text: "Olá" },
  { lang: "fr", text: "Bonjour" },
  { lang: "de", text: "Hallo" },
  { lang: "it", text: "Ciao" },
  { lang: "ar", text: "مرحبا" },
];

function Card({
  className,
  title,
  body,
  why,
  children,
}: {
  className?: string;
  title: string;
  body: string;
  why: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "mk-reveal group flex min-w-0 flex-col rounded-lg border border-line bg-surface transition-colors duration-200 hover:border-line-strong",
        className,
      )}
    >
      <div className="flex flex-col gap-2 px-6 pt-6">
        <h3 className="text-lg text-ink">{title}</h3>
        <p className="max-w-[56ch] text-base text-ink-muted">{body}</p>
      </div>
      <div className="flex flex-1 flex-col justify-center px-6 py-6">{children}</div>
      <p className="rounded-b-lg border-t border-line px-6 py-3.5 text-sm text-ink-muted">
        <span className="font-medium text-ink">Why it matters: </span>
        {why}
      </p>
    </li>
  );
}

function Screen({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col rounded-md border border-line bg-paper p-4", className)}>{children}</div>;
}

function Check({
  icon,
  label,
  strong = false,
  children,
}: {
  icon: ReactNode;
  label: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <dt className="flex items-center gap-3 text-ink-muted">
        <span aria-hidden="true" className={cn("text-base", strong ? "text-rust" : "text-ink-muted")}>
          {icon}
        </span>
        {label}
      </dt>
      <dd className="ml-auto text-right text-ink">{children}</dd>
    </div>
  );
}

/** A usage bar with the 80 percent warning zone and the 100 percent cap marked. */
export function CapMeter({ value, className }: { value: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative", className)}>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-[80%] right-0 bg-rust-soft" />
        <div className="mk-fill absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${value}%` }} />
      </div>
      <span className="absolute -top-1 left-[80%] h-4 w-px bg-rust" />
      <span className="absolute -top-1 right-0 h-4 w-px bg-rust" />
      <div className="relative mt-2 h-4 text-xs text-ink-muted tabular-nums">
        <span className="absolute left-0">0</span>
        <span className="absolute left-[80%] -translate-x-1/2">80</span>
        <span className="absolute right-0">100</span>
      </div>
    </div>
  );
}
