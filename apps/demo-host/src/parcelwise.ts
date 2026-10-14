// Parcelwise: a shipping platform's customer dashboard. Signed out, there is
// only a sign-in page and no chat at all. Signed in, the widget runs in
// identified mode with a token this site's server signs for the customer.

import { html, raw, type Html } from "./html.ts";
import { document, noteFor, tryAsking, type Context, type Install } from "./shell.ts";
import { PARCELWISE, PARCELWISE_SUGGESTIONS, PERSONAS, PLANS, type Persona, type Status } from "./sites.ts";

const BASE = `/${PARCELWISE.slug}`;
export const TOKEN_PATH = `${BASE}/docent-token`;

const icon = (paths: string, extra = ""): Html =>
  raw(
    `<svg class="i" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths
      .split("|")
      .map((d) => `<path d="${d}"/>`)
      .join("")}${extra}</svg>`,
  );

const ICONS = {
  overview: icon("M3 3.5h6v6H3z|M11 3.5h6v4h-6z|M11 9.5h6v7h-6z|M3 11.5h6v5H3z"),
  box: icon("M3 6.5 10 3l7 3.5v7L10 17l-7-3.5z|M3 6.5l7 3.5 7-3.5|M10 10v7"),
  label: icon("M3.5 4.5h13v11h-13z|M6.5 8h7|M6.5 11h4"),
  key: icon("M11.5 8.5 17 3|M14.5 5.5l2 2", `<circle cx="7.5" cy="12.5" r="4"/>`),
  card: icon("M2.5 5h15v10h-15z|M2.5 8.5h15|M5.5 12h3"),
  check: icon("M4.5 10.5l3.5 3.5 7.5-8"),
  arrow: icon("M3.5 10h12|M11.5 6l4 4-4 4"),
  truck: icon("M2.5 5.5h9v8h-9z|M11.5 8.5h3.5l2.5 2.5v2.5h-6", `<circle cx="6" cy="14.5" r="1.6"/><circle cx="14.5" cy="14.5" r="1.6"/>`),
  locker: icon("M4 3h12v14H4z|M10 3v14|M7 9.5v1|M13 9.5v1"),
  tag: icon("M3 10.5V3.5h7l7 7-7 7z", `<circle cx="6.8" cy="7.2" r="1.1"/>`),
  alert: icon("M10 3 18 17H2z|M10 8.5v3.5|M10 14.6v.1"),
  chat: icon("M3 4.5h14v9H9.5L6 16.5v-3H3z"),
  out: icon("M8 4H4v12h4|M12 6.5 15.5 10 12 13.5|M15.5 10H8"),
};

/** The Parcelwise mark: a parcel on the accent. */
const MARK = raw(
  `<svg class="pw-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="7" class="pw-mark-bg"/><path d="M9 12.2 16 8.7l7 3.5v8.1L16 23.8l-7-3.5z M9 12.2l7 3.5 7-3.5 M16 15.7v8.1" class="pw-mark-box"/></svg>`,
);

const STATUS: Record<Status, { label: string; icon: Html; tone: "done" | "move" | "wait" | "alert" }> = {
  delivered: { label: "Delivered", icon: ICONS.check, tone: "done" },
  in_transit: { label: "In transit", icon: ICONS.arrow, tone: "move" },
  out_for_delivery: { label: "Out for delivery", icon: ICONS.truck, tone: "move" },
  available_for_pickup: { label: "At pickup point", icon: ICONS.locker, tone: "wait" },
  pre_transit: { label: "Label created", icon: ICONS.tag, tone: "wait" },
  failure: { label: "Address problem", icon: ICONS.alert, tone: "alert" },
};

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const count = (value: number) => value.toLocaleString("en-US");
const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2);

function day(daysAgo: number, now: Date): string {
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** A barcode drawn from a seed, so the label art looks like a real label. */
function barcode(seed: string): Html {
  let x = 0;
  const bars: string[] = [];
  for (let i = 0; x < 236; i++) {
    const code = seed.charCodeAt(i % seed.length) + i * 7;
    const width = (code % 3) + 1;
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="48"/>`);
    x += width + ((code >> 2) % 2) + 1;
  }
  return raw(`<svg class="la-bars" viewBox="0 0 240 48" preserveAspectRatio="none" aria-hidden="true" focusable="false">${bars.join("")}</svg>`);
}

const LABEL_ART = html`<div class="label-art" role="img" aria-label="A Parcelwise shipping label for a 2-day Larkspur Express parcel">
  <div aria-hidden="true">
    <div class="la-head"><span class="la-carrier">Larkspur Express</span><span class="la-service">2-day</span></div>
    <div class="la-addrs">
      <div><p class="la-k">From</p><p>Maison Dubois<br>418 Mercer Street<br>New York, NY 10012</p></div>
      <div><p class="la-k">Ship to</p><p class="la-to">Léa Tremblay<br>2150 Rue Saint-Denis<br>Montréal QC H2X 3K8</p></div>
    </div>
    ${barcode("PW482241903517")}
    <div class="la-foot"><span class="la-track">PW 4822 4190 3517</span><span>1.2 kg</span></div>
  </div>
</div>`;

const CARRIERS = ["Ridgeway Parcel", "Larkspur Express", "Bluecrest Post", "Harborline Freight", "Kestrel Courier"];

export function signInPage(ctx: Context): string {
  const body = html`<main id="main" class="pw-auth">
  <section class="pw-auth-brand" aria-labelledby="pitch-title">
    <a class="pw-brand" href="${BASE}">${MARK}<span>Parcelwise</span></a>
    <div class="pw-pitch">
      <h2 id="pitch-title">Labels, tracking, and returns for online stores.</h2>
      <p>One dashboard and one API for five carriers, from same-day couriers to post in 190 countries.</p>
    </div>
    ${LABEL_ART}
    <ul class="pw-carriers" aria-label="Carriers">${CARRIERS.map((c) => html`<li>${c}</li>`)}</ul>
  </section>
  <section class="pw-auth-panel" aria-labelledby="signin-title">
    <div class="pw-auth-card">
      <h1 id="signin-title">Sign in to Parcelwise</h1>
      <p class="pw-muted">Choose a demo customer. Each one runs a different store on a different plan, so support answers each one differently.</p>
      <form method="post" action="${BASE}/sign-in">
        <ul class="pw-personas">
          ${PERSONAS.map(
            (p) => html`<li><button type="submit" name="persona" value="${p.id}" class="pw-persona">
            <span class="pw-avatar" aria-hidden="true">${initials(p.name)}</span>
            <span class="pw-persona-text"><span class="pw-persona-name"><span class="vh">Sign in as </span>${p.name}</span><span class="pw-persona-org">${p.account.company}</span></span>
            <span class="pw-plan-tag">${p.account.plan}<span class="vh"> plan</span></span>
            ${ICONS.arrow}
          </button></li>`,
          )}
        </ul>
      </form>
      <div class="pw-note">
        <p><strong>These are demo accounts.</strong> No password needed. Parcelwise and its customers are fictional.</p>
        <p>Once you are in, this site's server signs a short-lived token for your account, and the support chat uses it to answer from your plan. There is no chat on this page.</p>
      </div>
    </div>
  </section>
</main>`;
  return document({
    ctx,
    site: PARCELWISE,
    title: "Sign in, Parcelwise",
    description: "Sign in to the Parcelwise shipping dashboard. A fictional product for the Docent showcase.",
    stylesheet: "parcelwise",
    icon: "parcelwise",
    note: "Parcelwise is a fictional company. Sign in as a demo customer to see Docent inside the dashboard.",
    embed: { mode: "none" },
    body,
    bodyClass: "pw pw-signed-out",
  });
}

export function dashboardPage(ctx: Context, install: Install | null, persona: Persona, now = new Date()): string {
  const { account } = persona;
  const plan = PLANS[account.plan];
  const first = persona.name.split(" ")[0] ?? persona.name;
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const nextInvoice = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const fees = account.labelsThisMonth * plan.perLabel;

  const nav: { href: string; label: string; icon: Html }[] = [
    { href: "#overview", label: "Overview", icon: ICONS.overview },
    { href: "#shipments", label: "Shipments", icon: ICONS.box },
    { href: "#labels", label: "Labels", icon: ICONS.label },
    { href: "#api-keys", label: "API keys", icon: ICONS.key },
    { href: "#billing", label: "Billing", icon: ICONS.card },
  ];

  // Explicit roles keep the table's meaning when small screens restyle rows as stacked cards.
  const shipments = html`<table role="table" aria-labelledby="ship-title">
    <thead role="rowgroup"><tr role="row">
      <th role="columnheader" scope="col">Shipment</th><th role="columnheader" scope="col">Recipient</th><th role="columnheader" scope="col" class="col-wide">Carrier</th><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col" class="col-wide">Created</th>
    </tr></thead>
    <tbody role="rowgroup">${account.shipments.map((s) => {
      const st = STATUS[s.status];
      return html`<tr role="row">
        <td role="cell" class="mono c-id">${s.id}</td>
        <td role="cell" class="c-to"><span class="cell-main">${s.recipient}</span><span class="cell-sub">${s.city}</span></td>
        <td role="cell" class="col-wide"><span class="cell-main">${s.carrier}</span><span class="cell-sub">${s.service}</span></td>
        <td role="cell" class="c-status"><span class="status status-${st.tone}">${st.icon}${st.label}</span></td>
        <td role="cell" class="col-wide nowrap">${day(s.created, now)}</td>
      </tr>`;
    })}</tbody>
  </table>`;

  const body = html`<div class="pw-app">
  <header class="pw-side">
    <div class="pw-side-in">
    <a class="pw-brand" href="${BASE}">${MARK}<span>Parcelwise</span></a>
    <div class="pw-org"><span class="pw-org-name">${account.company}</span><span class="pw-org-plan">${account.plan} plan</span></div>
    <nav class="pw-nav" aria-label="Dashboard">
      <ul>${nav.map(
        (item, i) => html`<li><a href="${item.href}"${i === 0 ? raw(' aria-current="page"') : ""}>${item.icon}<span>${item.label}</span></a></li>`,
      )}</ul>
    </nav>
    <div class="pw-user">
      <span class="pw-avatar" aria-hidden="true">${initials(persona.name)}</span>
      <span class="pw-user-text"><span class="pw-user-name">${persona.name}</span><span class="pw-user-mail">${persona.email}</span></span>
      <form method="post" action="${BASE}/sign-out" data-sign-out>
        <button type="submit" class="pw-signout">${ICONS.out}<span>Sign out</span></button>
      </form>
    </div>
    </div>
  </header>

  <main id="main" class="pw-main">
    <header class="pw-top" id="overview">
      <div>
        <p class="pw-date">${today}</p>
        <h1>${greeting}, ${first}</h1>
      </div>
      ${install ? html`<button type="button" class="pw-btn" data-open-chat>${ICONS.chat}Ask support</button>` : ""}
    </header>

    <section class="pw-kpis" aria-labelledby="kpi-title">
      <h2 id="kpi-title" class="vh">This month</h2>
      <div class="kpi"><p class="kpi-label">Labels this month</p><p class="kpi-value">${count(account.labelsThisMonth)}</p><p class="kpi-sub">Since ${monthStart}</p></div>
      <div class="kpi"><p class="kpi-label">In transit</p><p class="kpi-value">${count(account.inTransit)}</p><p class="kpi-sub">Moving with a carrier now</p></div>
      <div class="kpi kpi-alert"><p class="kpi-label">Need attention</p><p class="kpi-value">${count(account.attention)}</p><p class="kpi-sub">${ICONS.alert}${account.attention === 1 ? "An address problem to fix" : "Address problems to fix"}</p></div>
      <div class="kpi"><p class="kpi-label">Postage balance</p><p class="kpi-value">${money(account.balance)}</p><p class="kpi-sub">${account.autoReload ? "Auto-reload is on" : "Auto-reload is off"}</p></div>
    </section>

    <div class="pw-grid">
      <section id="shipments" class="pw-card pw-ship" aria-labelledby="ship-title">
        <div class="pw-card-head"><h2 id="ship-title">Recent shipments</h2><p>Last 7 days</p></div>
        <div class="pw-table" role="region" aria-label="Shipments table" tabindex="0">${shipments}</div>
      </section>
      ${
        install
          ? html`<div class="pw-try">${tryAsking(PARCELWISE_SUGGESTIONS, {
              id: "try",
              title: "Ask Parcelwise support",
              intro: `Support knows you are ${persona.name} on the ${account.plan} plan, because this site's server signed it. Pick a question: it opens the chat with the question ready to send.`,
            })}</div>`
          : ""
      }
    </div>

    <div class="pw-grid3">
      <section id="labels" class="pw-card" aria-labelledby="labels-title">
        <div class="pw-card-head"><h2 id="labels-title">Labels</h2><p>Unused labels</p></div>
        <ul class="pw-rows">${account.voidable.map(
          (v) => html`<li><span class="mono">${v.id}</span><span class="cell-sub">${v.carrier}</span><span class="pw-pill">${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} left to void</span></li>`,
        )}</ul>
        <p class="pw-foot">Labels download as a 4x6 inch PDF by default. ZPL for thermal printers costs nothing extra.</p>
      </section>

      <section id="api-keys" class="pw-card" aria-labelledby="keys-title">
        <div class="pw-card-head"><h2 id="keys-title">API keys</h2><p>${account.keys.length} active</p></div>
        <ul class="pw-rows">${account.keys.map(
          (k) => html`<li><span class="cell-main">${k.name}</span><span class="mono cell-sub">${k.key.slice(0, 8)}••••${k.key.slice(-4)}</span><span class="pw-pill pw-pill-${k.kind.toLowerCase()}">${k.kind}</span><span class="cell-sub pw-row-detail">${k.detail}</span></li>`,
        )}</ul>
        <p class="pw-foot">Live requests: ${plan.rps} a second, with bursts up to ${plan.burst}.</p>
      </section>

      <section id="billing" class="pw-card" aria-labelledby="billing-title">
        <div class="pw-card-head"><h2 id="billing-title">Billing</h2><p>${account.plan} plan</p></div>
        <dl class="pw-dl">
          <div><dt>Plan fee</dt><dd>${plan.monthly ? `${money(plan.monthly)} a month` : "No monthly fee"}</dd></div>
          <div><dt>Platform fees so far</dt><dd>${money(fees)} <span class="cell-sub">for ${count(account.labelsThisMonth)} labels</span></dd></div>
          <div><dt>Postage balance</dt><dd>${money(account.balance)}</dd></div>
          <div><dt>Next invoice</dt><dd>${nextInvoice}</dd></div>
        </dl>
        <p class="pw-foot">${
          account.autoReload
            ? "Auto-reload adds $200 when your balance drops below $50."
            : "Auto-reload is off. Add funds before your balance runs out."
        }</p>
      </section>
    </div>
  </main>
</div>`;

  return document({
    ctx,
    site: PARCELWISE,
    title: `Overview, ${account.company}, Parcelwise`,
    description: "The Parcelwise shipping dashboard. A fictional product for the Docent showcase.",
    stylesheet: "parcelwise",
    icon: "parcelwise",
    note: noteFor(
      ctx,
      install,
      "Parcelwise is a fictional company. The chat button in the corner is Docent. It knows who you are from a token this site's server signs.",
    ),
    embed: install ? { mode: "identified", install, tokenUrl: TOKEN_PATH } : { mode: "none" },
    body,
    bodyClass: "pw pw-signed-in",
  });
}
