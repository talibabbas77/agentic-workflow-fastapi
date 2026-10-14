// Lumen Notes: a notes app's public website and help center. Every visitor is
// anonymous, so the widget answers from public help articles only.

import { articles, search, type Article } from "./help.ts";
import { html, raw, type Html } from "./html.ts";
import { document, noteFor, tryAsking, type Context, type Embed, type Install } from "./shell.ts";
import { LUMEN, LUMEN_SUGGESTIONS } from "./sites.ts";

const BASE = `/${LUMEN.slug}`;
const HELP = `${BASE}/help`;

const icon = (paths: string, extra = ""): Html =>
  raw(
    `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths
      .split("|")
      .map((d) => `<path d="${d}"/>`)
      .join("")}${extra}</svg>`,
  );

const ICONS = {
  spark: icon("M12 3v4|M12 17v4|M3 12h4|M17 12h4|M6.3 6.3l2.5 2.5|M15.2 15.2l2.5 2.5|M6.3 17.7l2.5-2.5|M15.2 8.8l2.5-2.5"),
  tag: icon("M3.5 12.5V4h8.5l9 9-8.5 8.5-9-9z", `<circle cx="8" cy="8.5" r="1.4"/>`),
  receipt: icon("M6 3h12v18l-3-2-3 2-3-2-3 2V3z|M9 8h6|M9 12h6|M9 16h3"),
  lock: icon("M8 10V7a4 4 0 0 1 8 0v3", `<rect x="5" y="10" width="14" height="10" rx="2"/>`),
  sync: icon("M19.5 10.5A7.5 7.5 0 0 0 6 7.2L4.5 9|M4.5 4.5V9H9|M4.5 13.5A7.5 7.5 0 0 0 18 16.8l1.5-1.8|M19.5 19.5V15H15"),
  people: icon("M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6|M16 14.3c2.9.4 5 2.8 5 5.7", `<circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="8.5" r="2.5"/>`),
  box: icon("M4 7.5 12 3.5l8 4v9l-8 4-8-4v-9z|M4 7.5l8 4 8-4|M12 11.5v9"),
  plug: icon("M9 3v5|M15 3v5|M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8z|M12 16.5V21"),
  help: icon("M9.5 9a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 4|M12 17.2v.1", `<circle cx="12" cy="12" r="9"/>`),
  pen: icon("M4 20h4L19 9l-4-4L4 16v4z|M13.5 6.5l4 4"),
  laptop: icon("M5 6.5h14v9H5z|M2.5 18.5h19"),
  clock: icon("M12 7.5V12l3 2", `<circle cx="12" cy="12" r="8.5"/>`),
  check: icon("M5 12.5l4.5 4.5L19 7.5"),
  arrow: icon("M5 12h13|M13 6.5l5.5 5.5-5.5 5.5"),
  chat: icon("M4.5 5.5h15v10h-8l-4.5 4v-4h-2.5z|M8.5 10.5h7"),
};

/** The Lumen mark: a rising light over a ruled line. */
const MARK = raw(
  `<svg class="ln-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" class="ln-mark-bg"/><path d="M8.5 21a7.5 7.5 0 0 1 15 0z" class="ln-mark-sun"/><rect x="6" y="22.6" width="20" height="2.2" rx="1.1" class="ln-mark-line"/></svg>`,
);

const TOPICS: { slug: string; icon: Html; blurb: string }[] = [
  { slug: "getting-started", icon: ICONS.spark, blurb: "Create your account, install the apps, and write your first note." },
  { slug: "plans-and-pricing", icon: ICONS.tag, blurb: "What each plan costs and includes, from storage to version history." },
  { slug: "billing-and-refunds", icon: ICONS.receipt, blurb: "Invoices, payment methods, taxes, failed payments, and refunds." },
  { slug: "account-security", icon: ICONS.lock, blurb: "Passwords, two-step login, recovery codes, and signed-in devices." },
  { slug: "sync-and-offline", icon: ICONS.sync, blurb: "How sync works, working offline, conflicts, and deleted notes." },
  { slug: "sharing-and-permissions", icon: ICONS.people, blurb: "Permission levels, public links, workspace roles, and removing access." },
  { slug: "import-export", icon: ICONS.box, blurb: "Bring in Markdown, Word, and CSV files. Export as PDF, Markdown, or HTML." },
  { slug: "integrations", icon: ICONS.plug, blurb: "Calendar, Rookery Chat, the web clipper, and API tokens." },
  { slug: "troubleshooting", icon: ICONS.help, blurb: "Error messages, a blank desktop app, search problems, and sending logs." },
];

interface Topic {
  article: Article;
  icon: Html;
  blurb: string;
}

function ordered(all: Article[]): Topic[] {
  const known = TOPICS.flatMap(({ slug, icon, blurb }) => {
    const article = all.find((a) => a.slug === slug);
    return article ? [{ article, icon, blurb }] : [];
  });
  const rest = all
    .filter((a) => !TOPICS.some((t) => t.slug === a.slug))
    .map((article) => ({ article, icon: ICONS.help, blurb: article.summary }));
  return [...known, ...rest];
}

const embedFor = (install: Install | null): Embed => (install ? { mode: "anonymous", install } : { mode: "none" });

function header(current: "home" | "help"): Html {
  const link = (href: string, label: string, here: boolean) =>
    html`<a href="${href}"${here ? raw(' aria-current="page"') : ""}>${label}</a>`;
  return html`<header class="ln-header">
  <div class="wrap ln-header-in">
    <a class="ln-brand" href="${BASE}">${MARK}<span>Lumen Notes</span></a>
    <nav class="ln-nav" aria-label="Main">
      ${link(`${BASE}#features`, "Features", false)}
      ${link(`${BASE}#pricing`, "Pricing", false)}
      ${link(HELP, "Help center", current === "help")}
    </nav>
    <a class="btn btn-primary ln-cta" href="${BASE}#pricing">Start free</a>
  </div>
</header>`;
}

function footer(): Html {
  return html`<footer class="ln-footer">
  <div class="wrap ln-footer-in">
    <div class="ln-footer-brand">
      <a class="ln-brand" href="${BASE}">${MARK}<span>Lumen Notes</span></a>
      <p>A quiet place for everything you write down.</p>
    </div>
    <nav class="ln-footer-cols" aria-label="Footer">
      <div><h2>Product</h2><ul>
        <li><a href="${BASE}#features">Features</a></li>
        <li><a href="${BASE}#pricing">Pricing</a></li>
        <li><a href="${HELP}/integrations">Integrations</a></li>
      </ul></div>
      <div><h2>Help</h2><ul>
        <li><a href="${HELP}">Help center</a></li>
        <li><a href="${HELP}/getting-started">Getting started</a></li>
        <li><a href="${HELP}/troubleshooting">Troubleshooting</a></li>
      </ul></div>
      <div><h2>Showcase</h2><ul>
        <li><a href="/">All demos</a></li>
        <li><a href="/parcelwise">Parcelwise demo</a></li>
      </ul></div>
    </nav>
  </div>
  <div class="wrap ln-footer-note">
    <p>Lumen Notes is a fictional product, made to show Docent. Its help center is the one the assistant was taught from.</p>
  </div>
</footer>`;
}

function page(ctx: Context, install: Install | null, input: { title: string; description: string; current: "home" | "help"; main: Html }): string {
  return document({
    ctx,
    site: LUMEN,
    title: input.title,
    description: input.description,
    stylesheet: "lumen",
    icon: "lumen",
    note: noteFor(ctx, install, "Lumen Notes is a fictional company. The chat button in the corner is Docent, taught from this site's help center."),
    embed: embedFor(install),
    body: html`${header(input.current)}${input.main}${footer()}`,
    bodyClass: "ln",
  });
}

/** The app window in the hero, drawn in HTML. Purely decorative for assistive tech. */
const APP_MOCK = html`<div class="mock" role="img" aria-label="The Lumen Notes app with a launch checklist open in a team notebook">
  <div class="mock-bar" aria-hidden="true"><span></span><span></span><span></span><p>Souza Design Studio</p></div>
  <div class="mock-body" aria-hidden="true">
    <div class="mock-side">
      <p class="mock-search">Quick search <kbd>⌘K</kbd></p>
      <p class="mock-label">Notebooks</p>
      <ul class="mock-list">
        <li class="on">Product launch</li>
        <li>Research</li>
        <li>Meeting notes</li>
        <li>Reading list</li>
      </ul>
      <p class="mock-label">Tags</p>
      <ul class="mock-list mock-tags"><li>#roadmap</li><li>#pricing</li></ul>
      <p class="mock-sync">${ICONS.check}All changes synced</p>
    </div>
    <div class="mock-doc">
      <p class="mock-crumb">Product launch / Planning</p>
      <p class="mock-title">Launch checklist</p>
      <p class="mock-meta">Edited 2 minutes ago by Ana</p>
      <p class="mock-text">The new pricing page goes live on <mark>Thursday the 22nd</mark>. Everything below is due by Wednesday at noon.</p>
      <ul class="mock-checks">
        <li class="done">Write the release notes</li>
        <li class="done">Share the plan with the design team</li>
        <li>Export the roadmap as a PDF for the board</li>
        <li>Invite two guests to review the page</li>
      </ul>
      <div class="mock-slash"><p class="mock-typed">/ta<span class="mock-caret"></span></p>
        <ul><li class="on">Table</li><li>Task list</li><li>Tag</li></ul>
      </div>
    </div>
  </div>
</div>`;

const FEATURES: { icon: Html; title: string; body: string }[] = [
  {
    icon: ICONS.pen,
    title: "Fast to write",
    body: "Type / for headings, checklists, tables, and code. Start from a template such as Meeting notes or Project brief. Every change saves as you type.",
  },
  {
    icon: ICONS.laptop,
    title: "Works offline",
    body: "The desktop apps keep every notebook on your computer. On your phone, pick the notebooks you want with you.",
  },
  {
    icon: ICONS.sync,
    title: "Syncs in seconds",
    body: "Changes usually reach your other devices within 5 seconds. When two edits meet, Lumen merges them paragraph by paragraph.",
  },
  {
    icon: ICONS.clock,
    title: "Version history",
    body: "Go back to any earlier version of a note: 7 days on Free, 90 days on Plus, and a full year on Team.",
  },
  {
    icon: ICONS.people,
    title: "Share precisely",
    body: "Share one note or one notebook, with view, comment, or edit access. Guests on Team are free and do not take a seat.",
  },
  {
    icon: ICONS.plug,
    title: "Connects to your day",
    body: "Turn calendar events into meeting notes, clip pages from the web, and post notebook updates to Rookery Chat.",
  },
];

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "Quick search" },
  { keys: ["⌘", "N"], label: "New note" },
  { keys: ["⌘", "Shift", "D"], label: "Today's daily note" },
  { keys: ["⌘", "\\"], label: "Show or hide the sidebar" },
  { keys: ["⌘", "/"], label: "Every shortcut" },
];

const PLANS: { name: string; price: string; period: string; yearly: string; best: string; points: string[] }[] = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    yearly: "No card needed",
    best: "Trying Lumen",
    points: ["Sync on 2 devices, plus the web", "2 GB of storage", "7 days of version history"],
  },
  {
    name: "Plus",
    price: "$8",
    period: "per month",
    yearly: "$72 a year, billed annually",
    best: "Individuals who write a lot",
    points: ["50 GB of storage", "90 days of version history", "Up to 5 guests"],
  },
  {
    name: "Team",
    price: "$14",
    period: "per seat, per month",
    yearly: "$144 a seat a year, billed annually",
    best: "Teams of 3 to 500",
    points: ["100 GB per seat, pooled", "1 year of version history", "2 free guests for each seat"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "quote",
    yearly: "From 50 seats",
    best: "Larger organizations",
    points: ["Unlimited storage and history", "Single sign-on and provisioning", "A named support contact"],
  },
];

export async function homePage(ctx: Context, install: Install | null): Promise<string> {
  const all = ordered(await articles()).slice(0, 6);
  const main = html`<main id="main">
  <section class="hero" aria-labelledby="hero-title">
    <div class="wrap hero-in">
      <div class="hero-copy">
        <p class="eyebrow">Notes for people who write things down</p>
        <h1 id="hero-title"><span>Write it once.</span> <span>Find it every time.</span></h1>
        <p class="lead">Lumen Notes keeps your notes, plans, and research in one calm place. It works offline, syncs in seconds, and lets you share one notebook without sharing everything.</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#pricing">Start writing for free</a>
          <a class="btn btn-quiet" href="${HELP}">Browse the help center</a>
        </div>
        <p class="hero-small">Free for personal use, with no time limit. No card needed.</p>
      </div>
      ${APP_MOCK}
    </div>
  </section>

  <div class="wrap try-band">
    ${
      install
        ? tryAsking(LUMEN_SUGGESTIONS, {
            id: "try",
            title: "Questions before you start? Ask the assistant.",
            intro: "Pick a question. We copy it and open the chat in the corner, so you only paste and send. Answers come from our help center, with the section they used.",
          })
        : ""
    }
  </div>

  <section id="features" class="band" aria-labelledby="features-title">
    <div class="wrap">
      <div class="band-head">
        <p class="eyebrow">Features</p>
        <h2 id="features-title">Everything in its place</h2>
        <p>Workspaces hold notebooks, notebooks hold notes, and a note can hold pages five levels deep. Nothing else to learn.</p>
      </div>
      <ul class="features">
        ${FEATURES.map(
          (f) => html`<li class="feature"><span class="feature-icon">${f.icon}</span><h3>${f.title}</h3><p>${f.body}</p></li>`,
        )}
      </ul>
    </div>
  </section>

  <section class="band band-ink" aria-labelledby="keys-title">
    <div class="wrap keys-in">
      <div>
        <p class="eyebrow">Built for the keyboard</p>
        <h2 id="keys-title">Your hands stay where the words are.</h2>
        <p>Search, start a note, or open today's daily note without reaching for the mouse. On Windows and Linux, use Ctrl in place of ⌘.</p>
      </div>
      <dl class="keys">
        ${SHORTCUTS.map(
          (s) => html`<div class="key-row"><dt>${s.label}</dt><dd>${s.keys.map((k) => html`<kbd>${k}</kbd>`)}</dd></div>`,
        )}
      </dl>
    </div>
  </section>

  <section id="pricing" class="band" aria-labelledby="pricing-title">
    <div class="wrap">
      <div class="band-head">
        <p class="eyebrow">Pricing</p>
        <h2 id="pricing-title">Free to start. Fair as you grow.</h2>
        <p>Prices are in US dollars and do not include tax. Students and teachers get Plus free for a year with a school email address.</p>
      </div>
      <ul class="plans">
        ${PLANS.map(
          (p) => html`<li class="plan${p.name === "Team" ? " plan-team" : ""}">
          <h3>${p.name}</h3>
          <p class="plan-best">${p.best}</p>
          <p class="plan-price"><span>${p.price}</span> ${p.period}</p>
          <p class="plan-yearly">${p.yearly}</p>
          <ul>${p.points.map((point) => html`<li>${ICONS.check}${point}</li>`)}</ul>
        </li>`,
        )}
      </ul>
      <p class="plans-more"><a href="${HELP}/plans-and-pricing">Compare every plan in the help center ${ICONS.arrow}</a></p>
    </div>
  </section>

  <section class="band band-soft" aria-labelledby="help-title">
    <div class="wrap">
      <div class="band-head band-head-row">
        <div>
          <p class="eyebrow">Help center</p>
          <h2 id="help-title">Answers, written down</h2>
          <p>Our guides cover setup, billing, sync, sharing, and the error messages you might meet. The assistant in the corner reads the same guides.</p>
        </div>
        <a class="btn btn-quiet" href="${HELP}">Visit the help center</a>
      </div>
      <ul class="topics">
        ${all.map(
          ({ article, icon: topicIcon, blurb }) => html`<li><a class="topic" href="${HELP}/${article.slug}">
          <span class="topic-icon">${topicIcon}</span>
          <span class="topic-title">${article.title}</span>
          <span class="topic-sum">${blurb}</span>
        </a></li>`,
        )}
      </ul>
    </div>
  </section>
</main>`;
  return page(ctx, install, {
    title: "Lumen Notes: write it once, find it every time",
    description: "Lumen Notes keeps your notes, plans, and research in one calm place. A fictional product for the Docent showcase.",
    current: "home",
    main,
  });
}

const POPULAR: [string, string][] = [
  ["sync-and-offline#recovering-deleted-notes", "Recover a deleted note"],
  ["account-security#if-you-lose-your-phone-or-security-key", "Lost your phone for two-step login"],
  ["plans-and-pricing#version-history-by-plan", "Version history on each plan"],
  ["billing-and-refunds#refunds", "Refunds"],
  ["import-export#exporting-a-note-or-notebook", "Export a note as PDF"],
  ["troubleshooting#error-messages", "Error messages"],
];

function askBand(): Html {
  return html`<section class="ask-band" aria-labelledby="ask-title">
  <div class="wrap ask-in">
    <span class="ask-icon">${ICONS.chat}</span>
    <div>
      <h2 id="ask-title">Still stuck?</h2>
      <p>Ask the assistant. It answers from these guides and shows the section it used. When the guides do not cover your question, it passes it to our support team, who reply by email.</p>
    </div>
    <button type="button" class="btn btn-primary" data-open-chat>Ask the assistant</button>
  </div>
</section>`;
}

export async function helpPage(ctx: Context, install: Install | null, query: string): Promise<string> {
  const all = await articles();
  const q = query.trim().slice(0, 100);
  const hits = q ? search(all, q) : [];
  const results = html`<section class="wrap results" aria-labelledby="results-title">
    <h2 id="results-title">${hits.length ? `${hits.length} ${hits.length === 1 ? "result" : "results"} for "${q}"` : `No guides match "${q}"`}</h2>
    ${
      hits.length
        ? html`<ol class="hits">${hits.map(
            (hit) => html`<li><a href="${HELP}/${hit.article.slug}${hit.section ? `#${hit.section.id}` : ""}">
            <span class="hit-path">${hit.article.title}</span>
            <span class="hit-title">${hit.section?.title ?? hit.article.title}</span>
          </a><p>${raw(hit.snippet)}</p></li>`,
          )}</ol>`
        : html`<p class="no-hits">Try fewer words, or ask the assistant. ${
            install ? html`<button type="button" class="link-button" data-ask="${q}">Ask the assistant "${q}"</button>` : ""
          }</p>`
    }
    <p><a class="back" href="${HELP}">See every topic</a></p>
    <p class="try-status" role="status" aria-live="polite"></p>
  </section>`;

  const topics = html`<section class="wrap help-topics" aria-labelledby="topics-title">
    <h2 id="topics-title">Browse by topic</h2>
    <ul class="topic-grid">
      ${ordered(all).map(
        ({ article, icon: topicIcon, blurb }) => html`<li class="topic-card">
        <h3><span class="topic-icon">${topicIcon}</span><a href="${HELP}/${article.slug}">${article.title}</a></h3>
        <p>${blurb}</p>
        <ul>${article.sections
          .filter((s) => s.level === 2)
          .slice(0, 3)
          .map((s) => html`<li><a href="${HELP}/${article.slug}#${s.id}">${s.title}</a></li>`)}</ul>
      </li>`,
      )}
    </ul>
  </section>`;

  const main = html`<main id="main">
  <section class="help-hero${q ? " help-hero-compact" : ""}" aria-labelledby="help-hero-title">
    <div class="wrap help-hero-in">
      <div class="help-hero-copy">
        <p class="eyebrow">Help center</p>
        <h1 id="help-hero-title">How can we help?</h1>
        <form class="search" role="search" action="${HELP}" method="get">
          <label class="vh" for="q">Search the help center</label>
          <input id="q" name="q" type="search" value="${q}" placeholder="For example: version history" autocomplete="off">
          <button type="submit" class="btn btn-primary">Search</button>
        </form>
        ${
          q
            ? ""
            : html`<h2 class="popular-title">Popular guides</h2>
        <ul class="popular">${POPULAR.map(
          ([href, label]) => html`<li><a href="${HELP}/${href}">${label}${ICONS.arrow}</a></li>`,
        )}</ul>`
        }
      </div>
      ${
        install && !q
          ? tryAsking(LUMEN_SUGGESTIONS, {
              id: "try",
              title: "Or ask the assistant",
              intro: "Pick a question. We copy it and open the chat, so you only paste and send.",
            })
          : ""
      }
    </div>
  </section>
  ${q ? results : topics}
  ${install ? askBand() : ""}
</main>`;
  return page(ctx, install, {
    title: q ? `Search: ${q}, Lumen Notes help` : "Lumen Notes help center",
    description: "Guides for Lumen Notes: getting started, plans, billing, sync, sharing, and troubleshooting.",
    current: "help",
    main,
  });
}

export async function articlePage(ctx: Context, install: Install | null, slug: string): Promise<string | null> {
  const all = await articles();
  const article = all.find((a) => a.slug === slug);
  if (!article) return null;
  const list = ordered(all);
  const index = list.findIndex((t) => t.article.slug === slug);
  const next = list[(index + 1) % list.length]?.article;

  const main = html`<main id="main">
<div class="wrap article-page">
  <nav class="crumbs" aria-label="Breadcrumb"><ol>
    <li><a href="${HELP}">Help center</a></li>
    <li><span aria-current="page">${article.title}</span></li>
  </ol></nav>
  <div class="article-grid">
    <nav class="toc" aria-labelledby="toc-title">
      <h2 id="toc-title">On this page</h2>
      <ul>${article.sections.map(
        (s) => html`<li class="toc-${s.level}"><a href="#${s.id}">${s.title}</a></li>`,
      )}</ul>
    </nav>
    <article class="prose">
      <h1>${article.title}</h1>
      ${raw(article.body)}
      ${
        next && next.slug !== slug
          ? html`<p class="next"><a href="${HELP}/${next.slug}"><span>Next guide</span>${next.title} ${ICONS.arrow}</a></p>`
          : ""
      }
    </article>
  </div>
</div>
${install ? askBand() : ""}
</main>`;
  return page(ctx, install, {
    title: `${article.title}, Lumen Notes help`,
    description: article.summary,
    current: "help",
    main,
  });
}
