import {
  ArchiveIcon,
  BrowserIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  GlobeSimpleXIcon,
  KeyIcon,
  ProhibitIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageIntro, Section } from "@/components/marketing/section";
import { TextLink } from "@/components/ui/text-link";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Docent keeps each company's data apart, verifies who is asking, isolates the widget, and handles retention and backups.",
};

const facts: { icon: ReactNode; title: string; body: ReactNode }[] = [
  {
    icon: <DatabaseIcon />,
    title: "Workspaces are separated by the database",
    body: "Every row belongs to one workspace, and Postgres row-level security filters every query by it. If our application code asked for another workspace's data, the database would return nothing.",
  },
  {
    icon: <KeyIcon />,
    title: "Identity comes from your server",
    body: "Your server signs a short-lived ES256 token for the logged-in user and Docent checks it with your public key. We store only public keys, so nothing on our side can sign a token for your users.",
  },
  {
    icon: <BrowserIcon />,
    title: "The widget is isolated",
    body: "The widget runs in an iframe on its own origin. It talks to your page with postMessage and checks the origin of every message, and only the domains you list may load it.",
  },
  {
    icon: <GlobeSimpleXIcon />,
    title: "The crawler stays on the public internet",
    body: "When Docent fetches your pages or sitemap, it refuses private and internal network addresses, so a crafted link cannot reach systems behind your firewall.",
  },
  {
    icon: <ArchiveIcon />,
    title: "Backups are encrypted",
    body: "Database backups are encrypted before they leave the server, and restoring them is tested.",
  },
  {
    icon: <ClockCounterClockwiseIcon />,
    title: "Conversations are kept for 90 days",
    body: "That is the default retention for conversations. After that they are deleted.",
  },
  {
    icon: <ProhibitIcon />,
    title: "No training on your data",
    body: "We never use your documents or your customers' conversations to train models.",
  },
];

export default function SecurityPage() {
  return (
    <>
      <PageIntro title="Security">
        <p>
          Docent holds your help content and your customers&apos; questions. This page says plainly how that data is
          kept apart, who can read it, and how long we keep it.
        </p>
      </PageIntro>
      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8 sm:pb-24">
        <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-2">
          {facts.map((fact, index) => (
            <li
              key={fact.title}
              // An odd last item spans the row, so the grid never shows an empty cell.
              className={`flex gap-4 bg-surface p-6 ${index === facts.length - 1 && facts.length % 2 === 1 ? "md:col-span-2" : ""}`}
            >
              <span aria-hidden="true" className="mt-0.5 text-xl text-rust">
                {fact.icon}
              </span>
              <div className="flex flex-col gap-1.5">
                <h2 className="text-md text-ink">{fact.title}</h2>
                <p className="text-base text-ink-muted">{fact.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <Section
        id="report"
        title="Reporting a problem"
        intro={
          <p>
            If you find a security issue, please tell us before you tell anyone else. See the{" "}
            <TextLink href="/contact">contact page</TextLink>. We reply to every report.
          </p>
        }
      />
    </>
  );
}
