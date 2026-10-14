import {
  ArchiveIcon,
  ArrowRightIcon,
  BrowserIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  GlobeSimpleXIcon,
  KeyIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Fact = { icon: ReactNode; title: string; body: string; detail?: string };

const isolation: Fact = {
  icon: <DatabaseIcon />,
  title: "Workspaces are separated by the database",
  body: "Every row belongs to one workspace, and Postgres row-level security filters every query by it. If our application code asked for another workspace's data, the database would return nothing.",
  detail:
    "Row-level security is enabled and forced on every workspace table, the app's database roles cannot bypass it, and with no workspace set a query returns no rows.",
};

const training: Fact = {
  icon: <ProhibitIcon />,
  title: "Never used to train models",
  body: "We never use your documents or your customers' conversations to train models.",
  detail: "Your sources are only searched to answer your own customers.",
};

const untrusted: Fact = {
  icon: <ShieldCheckIcon />,
  title: "Visitor input is treated as untrusted",
  body: "Messages and documents are passed to the model as labeled data, never as instructions, and every reply is checked before it is shown.",
  detail:
    "The model has no tools that reach the network or the database, and links in a reply are allowed only to the pages it cites.",
};

const backups: Fact = {
  icon: <ArchiveIcon />,
  title: "Backups are encrypted",
  body: "Database backups are encrypted before they leave the server, and restoring them is tested.",
  detail: "Daily dumps are encrypted to a key held offline, and a restore drill brings the latest one back in a fresh database and reruns the isolation tests.",
};

const retention: Fact = {
  icon: <ClockCounterClockwiseIcon />,
  title: "Conversations are kept for 90 days",
  body: "That is the default retention for conversations. After that they are deleted.",
  detail: "A deleted workspace is purged 30 days after deletion.",
};

const identity: Fact = {
  icon: <KeyIcon />,
  title: "Identity comes from your server",
  body: "Your server signs a short-lived ES256 token for the logged-in user and Docent checks it with your public key. We store only public keys, so nothing on our side can sign a token for your users.",
  detail: "Tokens live at most 15 minutes and each one works once.",
};

const widget: Fact = {
  icon: <BrowserIcon />,
  title: "The widget is isolated",
  body: "The widget runs in an iframe on its own origin. It talks to your page with postMessage and checks the origin of every message, and only the domains you list may load it.",
  detail: "It never reads cookies or storage on your page, and the browser refuses to show it on sites you did not allow.",
};

const crawler: Fact = {
  icon: <GlobeSimpleXIcon />,
  title: "The crawler stays on the public internet",
  body: "When Docent fetches your pages or sitemap, it refuses private and internal network addresses, so a crafted link cannot reach systems behind your firewall.",
  detail: "Every connection, including each redirect, checks the address the host resolves to.",
};

/** The compact trust grid on the home page: five facts and a way into the full page. */
export function TrustFacts() {
  const facts = [isolation, training, untrusted, backups, retention];
  return (
    <ul className="mk-reveal grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {facts.map((fact) => (
        <li key={fact.title} className="flex flex-col gap-3 bg-surface p-6">
          <FactBody fact={fact} />
        </li>
      ))}
      <li className="flex bg-surface">
        <Link
          href="/security"
          className="group flex flex-1 flex-col justify-between gap-6 p-6 transition-colors duration-150 hover:bg-surface-2"
        >
          <span className="flex flex-col gap-2">
            <span className="text-md font-semibold tracking-[-0.02em] text-ink">Read the security page</span>
            <span className="text-base text-ink-muted">
              How data is kept apart, how the widget is isolated, and how to report a problem.
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-base font-medium text-rust">
            Security
            <ArrowRightIcon
              aria-hidden="true"
              className="size-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
            />
          </span>
        </Link>
      </li>
    </ul>
  );
}

/** All seven facts for /security, in a bento: 7 + 5, 4 + 4 + 4, 6 + 6. */
export function SecurityBento() {
  const layout: { fact: Fact; className: string }[] = [
    { fact: isolation, className: "md:col-span-2 lg:col-span-7" },
    { fact: training, className: "lg:col-span-5" },
    { fact: identity, className: "lg:col-span-4" },
    { fact: widget, className: "lg:col-span-4" },
    { fact: crawler, className: "lg:col-span-4" },
    { fact: backups, className: "lg:col-span-6" },
    { fact: retention, className: "lg:col-span-6" },
  ];
  return (
    <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
      {layout.map(({ fact, className }) => (
        <li
          key={fact.title}
          className={cn(
            "mk-reveal flex flex-col gap-3 rounded-lg border border-line bg-surface p-6 transition-colors duration-200 hover:border-line-strong",
            className,
          )}
        >
          <FactBody fact={fact} />
        </li>
      ))}
    </ul>
  );
}

function FactBody({ fact }: { fact: Fact }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-paper text-lg text-rust"
      >
        {fact.icon}
      </span>
      <h3 className="text-md text-ink">{fact.title}</h3>
      <p className="text-base text-ink-muted">{fact.body}</p>
      {fact.detail ? (
        <p className="mt-auto border-t border-line pt-3 text-sm text-ink-muted">
          <span className="font-medium text-ink">How: </span>
          {fact.detail}
        </p>
      ) : null}
    </>
  );
}

const will = [
  "Answer only from the docs you teach it",
  "Cite the page each answer used",
  "Hand off with a summary when no source supports an answer",
  "Check every signed token with your public key",
  "Treat visitor messages as data, not instructions",
  "Switch to a contact form at your monthly cap",
];

const willNot = [
  "Guess, or fill gaps from general knowledge",
  "Offer live chat. Your team replies by email",
  "Read cookies or storage on your site",
  "Trust a name or user id typed into the chat",
  "Bill you for overage",
  "Use your data to train models",
];

/** "Docent will" and "Docent will not", side by side. */
export function WillWont() {
  return (
    <div className="mk-reveal grid gap-4 md:grid-cols-2">
      <List title="Docent will" items={will} icon={<CheckIcon weight="bold" />} positive />
      <List title="Docent will not" items={willNot} icon={<XIcon weight="bold" />} />
    </div>
  );
}

function List({
  title,
  items,
  icon,
  positive = false,
}: {
  title: string;
  items: string[];
  icon: ReactNode;
  positive?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <h3 className="border-b border-line px-6 py-4 text-md text-ink">{title}</h3>
      <ul className="flex flex-col divide-y divide-line">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-3 px-6 py-3 text-base text-ink">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs",
                positive ? "bg-ink text-paper" : "border border-rust text-rust",
              )}
            >
              {icon}
            </span>
            {positive ? null : <span className="sr-only">Will not: </span>}
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
