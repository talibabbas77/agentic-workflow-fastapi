import {
  ArrowUpRightIcon,
  GlobeSimpleIcon,
  HeadsetIcon,
  KeyIcon,
  QuotesIcon,
  UserCircleCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { SHOWCASE_APP_URL, SHOWCASE_PUBLIC_URL } from "@/lib/site";

interface Showcase {
  url: string;
  audience: string;
  name: string;
  kind: string;
  body: ReactNode;
  shows: { icon: ReactNode; label: string }[];
  cta: string;
}

const showcases: Showcase[] = [
  {
    url: SHOWCASE_PUBLIC_URL,
    audience: "Anonymous visitors",
    name: "Lumen Notes",
    kind: "A notes app's public site and help center",
    body: (
      <>
        Ask how many devices the Free plan allows and the answer cites the help center section it came from. Ask about
        something the docs never mention, such as voice dictation, and Docent hands you to the team and asks for your
        email.
      </>
    ),
    shows: [
      { icon: <QuotesIcon />, label: "Cited answers" },
      { icon: <HeadsetIcon />, label: "Handoff by email" },
    ],
    cta: "Open the public help site",
  },
  {
    url: SHOWCASE_APP_URL,
    audience: "Signed-in customers",
    name: "Parcelwise",
    kind: "A shipping platform's customer dashboard",
    body: (
      <>
        Sign in as one of three demo customers and ask &ldquo;What&rsquo;s my per-label fee?&rdquo; The answer comes
        from that customer&rsquo;s plan, which the dashboard&rsquo;s server signs into a short-lived token.
      </>
    ),
    shows: [
      { icon: <KeyIcon />, label: "Server-signed token" },
      { icon: <UserCircleCheckIcon />, label: "Plan-aware answers" },
    ],
    cta: "Open the customer app",
  },
];

/** Shown without the scheme, like an address bar. */
const displayUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Two demo sites we built, each with the real widget and agent. No client JavaScript. */
export function LiveShowcase() {
  return (
    <div className="mk-reveal flex flex-col gap-6">
      <ul className="grid gap-4 md:grid-cols-2">
        {showcases.map((site) => (
          <li key={site.name} className="flex">
            <article
              aria-labelledby={`live-${site.name.replace(/\s+/g, "-").toLowerCase()}`}
              className="flex w-full flex-col rounded-lg border border-line bg-surface"
            >
              <div className="flex items-center border-b border-line px-4 py-3 sm:px-5">
                <span className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 font-mono text-xs text-ink-muted">
                  <GlobeSimpleIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{displayUrl(site.url)}</span>
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-4 px-5 py-6 sm:px-6">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-rust">{site.audience}</p>
                  <h3 id={`live-${site.name.replace(/\s+/g, "-").toLowerCase()}`} className="text-xl text-ink">
                    {site.name}
                  </h3>
                  <p className="text-sm text-ink-muted">{site.kind}</p>
                </div>
                <p className="max-w-[56ch] text-base text-ink-muted">{site.body}</p>
                <ul className="flex flex-wrap gap-2" aria-label="What it shows">
                  {site.shows.map((item) => (
                    <li
                      key={item.label}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink"
                    >
                      <span aria-hidden="true" className="text-md text-rust">
                        {item.icon}
                      </span>
                      {item.label}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-2">
                  <ButtonLink href={site.url} target="_blank" rel="noopener noreferrer">
                    {site.cta}
                    <ArrowUpRightIcon aria-hidden="true" className="size-4" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </ButtonLink>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">
        Both companies are fictional. The widget, the agent, and the model are the real ones, so an answer can take a
        few seconds.
      </p>
    </div>
  );
}
