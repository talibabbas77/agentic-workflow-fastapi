import { SITES, type Persona, type Site } from "./sites.ts";

export interface Install {
  company: string;
  widget: string;
  kid: string;
  private_jwk: Record<string, string>;
  widget_origin: string;
}

interface PageInput {
  site: Site;
  visitor: Persona | undefined;
  install: Install | null;
  /** False on the second port, which is not on the widget's allowed list. */
  allowed: boolean;
  otherOrigin: string;
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page({ site, visitor, install, allowed, otherOrigin }: PageInput): string {
  const tabs = SITES.map(
    (s) =>
      `<a href="/${s.slug}"${s.slug === site.slug ? ' aria-current="page"' : ""}>${escape(s.name)}</a>`,
  ).join("");
  const elsewhere = allowed
    ? `<a href="${escape(otherOrigin)}/${site.slug}">Try a site that is not allowed</a>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(site.name)}</title>
<link rel="stylesheet" href="/assets/host.css">
</head>
<body data-widget="${escape(install?.widget ?? "")}" data-signed-in="${visitor ? "true" : "false"}">
<div class="demo-bar">
  <p><strong>Demo customer site.</strong> ${
    allowed
      ? "The chat button in the corner is the Docent widget, added with one script tag."
      : "This origin is not on the widget's allowed list, so the browser refuses to show the chat."
  }</p>
  <nav aria-label="Demo sites">${tabs}${elsewhere}</nav>
</div>
<header class="site-header">
  <span class="site-name"><span class="site-mark" aria-hidden="true"></span>${escape(site.name)}</span>
  ${account(site, visitor)}
</header>
<main>
  ${site.screen}
  ${identityPanel(visitor, install)}
</main>
<script src="/assets/host.js"></script>
${
  install
    ? `<script src="${escape(install.widget_origin)}/widget/v1/loader.js" data-widget="${escape(install.widget)}" async></script>`
    : ""
}
</body>
</html>`;
}

function account(site: Site, visitor: Persona | undefined): string {
  if (visitor) {
    return `<form class="account" method="post" action="/${site.slug}/sign-out" data-sign-out>
  <span>${escape(visitor.name)} <span class="muted">${escape(visitor.context.plan ?? "")} plan</span></span>
  <button type="submit">Sign out</button>
</form>`;
  }
  const buttons = site.personas
    .map(
      (p) =>
        `<button type="submit" name="persona" value="${escape(p.id)}">${escape(p.name.split(" ")[0] ?? p.name)}, ${escape(p.context.plan ?? "")}</button>`,
    )
    .join("");
  return `<form class="account" method="post" action="/${site.slug}/sign-in">
  <span class="muted">Sign in as</span>${buttons}
</form>`;
}

function identityPanel(visitor: Persona | undefined, install: Install | null): string {
  if (!install) {
    return `<aside class="panel"><h2>Widget not installed</h2>
<p>Run <code>pnpm seed</code> with the API running. It creates the widget and saves this site's signing key.</p></aside>`;
  }
  if (!visitor) {
    return `<aside class="panel"><h2>What Docent knows</h2>
<p>Nothing about you. Visitors who are not signed in chat anonymously and get answers from public help articles only.</p></aside>`;
  }
  const claims = { sub: visitor.id, name: visitor.name, email: visitor.email, ctx: visitor.context };
  return `<aside class="panel"><h2>What Docent knows</h2>
<p>This site's server signs these claims with its private key. Docent checks the signature, so nothing typed in the chat can change who you are.</p>
<pre><code>${escape(JSON.stringify(claims, null, 2))}</code></pre></aside>`;
}
