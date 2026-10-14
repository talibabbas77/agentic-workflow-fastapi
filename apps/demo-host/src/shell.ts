// What every showcase page shares: the document, the thin "showcase" bar that
// says the company is fictional, the "Try asking" panel, and the Docent snippet.

import { html, raw, type Html } from "./html.ts";
import { LUMEN, PARCELWISE, SITES, type Site, type Suggestion } from "./sites.ts";

export interface Install {
  company: string;
  widget: string;
  kid: string;
  private_jwk: Record<string, string>;
  widget_origin: string;
}

/** Facts about the request that every page needs. */
export interface Context {
  /** False on the second port, which is not on the widget's allowed list. */
  allowed: boolean;
  allowedOrigin: string;
  /** The same pages on an origin the widgets do not allow; null when not served. */
  otherOrigin: string | null;
  /** Docent's own website, for the "About Docent" link. */
  docentUrl: string;
}

/** How this page embeds the widget. None: no snippet at all, so no chat button. */
export type Embed =
  | { mode: "none" }
  | { mode: "anonymous"; install: Install }
  | { mode: "identified"; install: Install; tokenUrl: string };

interface DocumentInput {
  ctx: Context;
  site: Site | undefined;
  title: string;
  description: string;
  stylesheet: "lumen" | "parcelwise" | "showcase";
  icon: "lumen" | "parcelwise" | "docent";
  /** The showcase bar's sentence for this page. */
  note: string;
  embed: Embed;
  body: Html;
  bodyClass?: string;
}

export const DOCENT_MARK = raw(
  `<svg class="docent-mark" viewBox="14 5 36 52" aria-hidden="true" focusable="false"><path class="dm-b" d="M14 12H32A18 18 0 0 1 32 48H23L14 57Z"/><path class="dm-r" d="M22 5H30V31L26 26.5L22 31Z"/></svg>`,
);

const ARROW = raw(
  `<svg class="i" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
);

export function document({ ctx, site, title, description, stylesheet, icon, note, embed, body, bodyClass }: DocumentInput): string {
  const widget = embed.mode === "none" ? "" : embed.install.widget;
  const loader =
    embed.mode === "none"
      ? null
      : html`<script src="${embed.install.widget_origin}/widget/v1/loader.js"${
          embed.mode === "anonymous" ? html` data-widget="${widget}"` : ""
        } async></script>`;

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="noindex">
<link rel="icon" href="/assets/${icon}-icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/showcase.css">
${stylesheet === "showcase" ? "" : html`<link rel="stylesheet" href="/assets/${stylesheet}.css">`}
</head>
<body class="${bodyClass ?? ""}" data-widget="${widget}" data-mode="${embed.mode}" data-token-url="${
    embed.mode === "identified" ? embed.tokenUrl : ""
  }">
<a class="skip" href="#main">Skip to content</a>
${showcaseBar(ctx, site, note)}
${body}
<script src="/assets/showcase.js"></script>
${loader}
</body>
</html>`.value;
}

function showcaseBar(ctx: Context, site: Site | undefined, note: string): Html {
  const other = site === LUMEN ? PARCELWISE : site === PARCELWISE ? LUMEN : undefined;
  return html`<aside class="sb" aria-label="About this demo">
  <div class="sb-in">
    <p class="sb-text"><a class="sb-brand" href="/">${DOCENT_MARK}<span>Docent showcase</span></a><span class="sb-note">${note}</span></p>
    <nav class="sb-nav" aria-label="Showcase">
      ${other ? html`<a href="/${other.slug}">Other demo: ${other.name}</a>` : ""}
      <a href="${ctx.docentUrl}">About Docent</a>
    </nav>
  </div>
</aside>`;
}

/** The showcase bar's sentence: the page's own, unless the widget cannot run here. */
export function noteFor(ctx: Context, install: Install | null, normal: string): string {
  if (!install) return "The widget is not installed yet. Run pnpm seed with the API running, then reload.";
  if (!ctx.allowed) return "This origin is not on the widget's allowed list, so the browser refuses to show the chat.";
  return normal;
}

/**
 * Suggested questions. A click opens the chat with the question in its message
 * field through Docent.open({ prefill }), so the visitor only presses Enter. The
 * host page never reaches into the widget's frame, and the widget never sends
 * the text by itself.
 */
export function tryAsking(suggestions: Suggestion[], { id, title, intro }: { id: string; title: string; intro: string }): Html {
  return html`<section class="try" aria-labelledby="${id}-title">
  <div class="try-head">
    <h2 id="${id}-title" class="try-title">${DOCENT_MARK}${title}</h2>
    <p class="try-intro" id="${id}-intro">${intro}</p>
  </div>
  <ul class="try-list">
    ${suggestions.map(
      (s) => html`<li><button type="button" class="try-q" data-ask="${s.question}" aria-describedby="${id}-intro">
      <span class="try-kind">${s.kind}</span>
      <span class="try-text">${s.question}</span>
      ${ARROW}
    </button></li>`,
    )}
  </ul>
  <p class="try-status" role="status" aria-live="polite"></p>
</section>`;
}

/** The showcase index at /: both sites, and the not-allowed origin for developers. */
export function indexPage(ctx: Context): string {
  const cards = SITES.map(
    (site) => html`<li class="ix-card">
      <img src="/assets/${site.slug === LUMEN.slug ? "lumen" : "parcelwise"}-icon.svg" alt="" width="40" height="40">
      <div>
        <h2>${site.name}</h2>
        <p class="ix-mode">${site.mode === "anonymous" ? "Anonymous visitors" : "Signed-in customers"}</p>
        <p>${
          site.mode === "anonymous"
            ? "A notes app's public website and help center. Ask the chat a question and it answers from the help articles with citations, or hands you to the team and asks for an email."
            : "A shipping platform's customer dashboard. Sign in as a demo customer and the chat answers from that customer's plan, using a token the dashboard's server signs."
        }</p>
        <a class="ix-link" href="/${site.slug}">Open ${site.name} ${ARROW}</a>
      </div>
    </li>`,
  );
  const body = html`<main id="main" class="ix">
  <h1>Two fictional companies, one support agent</h1>
  <p class="ix-lead">Both sites embed the Docent widget with one script tag, and each company taught the agent from its own help center.</p>
  <ul class="ix-cards">${cards}</ul>
  <section class="ix-dev" aria-labelledby="dev-title">
    <h2 id="dev-title">For developers</h2>
    <p>${
      !ctx.allowed
        ? html`This origin is not on the widgets' allowed list, so the browser refuses to show the chat. The working demos are on <a href="${ctx.allowedOrigin}/">${ctx.allowedOrigin}</a>.`
        : ctx.otherOrigin
          ? html`The same pages on <a href="${ctx.otherOrigin}/">${ctx.otherOrigin}</a> are on an origin the widgets do not allow, so the browser refuses to show the chat there.`
          : html`The widget runs only on origins each company allowed, and a signed-in customer's identity comes from a token this site's server signs.`
    }</p>
  </section>
</main>`;
  return document({
    ctx,
    site: undefined,
    title: "Docent showcase",
    description: "Two fictional companies with the Docent support widget installed.",
    stylesheet: "showcase",
    icon: "docent",
    note: "Pick a site. Each one is a fictional company with Docent installed.",
    embed: { mode: "none" },
    body,
    bodyClass: "ix-body",
  });
}
