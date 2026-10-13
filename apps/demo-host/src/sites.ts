// Two pretend customers of Docent, matching the seeded workspaces and their help centers.

export interface Persona {
  id: string;
  name: string;
  email: string;
  /** Extra claims, sent under `ctx`. The widget keeps only the ones it allows. */
  context: Record<string, string>;
}

export interface Site {
  slug: string;
  name: string;
  personas: Persona[];
  screen: string;
}

const mailbox = (local: string) => `docent-${local}@mailinator.com`;

const LUMEN_SCREEN = `
<div class="app">
  <aside class="sidebar" aria-label="Notebooks">
    <p class="label">Notebooks</p>
    <ul>
      <li class="active">Product launch</li>
      <li>Research</li>
      <li>Meeting notes</li>
      <li>Personal</li>
    </ul>
  </aside>
  <article class="doc">
    <p class="crumb">Product launch / Planning</p>
    <h1>Launch checklist</h1>
    <p class="meta">Edited 2 hours ago</p>
    <ul class="checklist">
      <li class="done">Write the release notes</li>
      <li class="done">Share the plan with the design team</li>
      <li>Export the roadmap as PDF for the board</li>
      <li>Move last year's notes to the archive notebook</li>
      <li>Invite two guests to review the pricing page</li>
    </ul>
  </article>
</div>`;

const PARCELWISE_SCREEN = `
<div class="app">
  <aside class="sidebar" aria-label="Sections">
    <p class="label">Shipping</p>
    <ul>
      <li class="active">Shipments</li>
      <li>Labels</li>
      <li>Returns</li>
      <li>Carriers</li>
      <li>API keys</li>
    </ul>
  </aside>
  <section class="doc">
    <p class="crumb">Shipments / Last 7 days</p>
    <h1>Shipments</h1>
    <table>
      <thead><tr><th scope="col">Shipment</th><th scope="col">To</th><th scope="col">Carrier</th><th scope="col">Status</th></tr></thead>
      <tbody>
        <tr><td>PW-48213</td><td>Lyon, FR</td><td>Colissimo</td><td><span class="tag">Delivered</span></td></tr>
        <tr><td>PW-48207</td><td>Austin, US</td><td>UPS</td><td><span class="tag">In transit</span></td></tr>
        <tr><td>PW-48199</td><td>Leeds, UK</td><td>Royal Mail</td><td><span class="tag">Label created</span></td></tr>
        <tr><td>PW-48185</td><td>Denver, US</td><td>USPS</td><td><span class="tag tag-alert">Address problem</span></td></tr>
      </tbody>
    </table>
  </section>
</div>`;

export const SITES: Site[] = [
  {
    slug: "lumen-notes",
    name: "Lumen Notes",
    screen: LUMEN_SCREEN,
    personas: [
      {
        id: "lumen-1042",
        name: "Ana Souza",
        email: mailbox("ana.souza"),
        context: { plan: "Team", workspace: "Souza Design Studio" },
      },
      {
        id: "lumen-2210",
        name: "Ben Carter",
        email: mailbox("ben.carter"),
        context: { plan: "Free", workspace: "Ben's notes" },
      },
    ],
  },
  {
    slug: "parcelwise",
    name: "Parcelwise",
    screen: PARCELWISE_SCREEN,
    personas: [
      {
        id: "pw-31877",
        name: "Chloe Dubois",
        email: mailbox("chloe.dubois"),
        context: { plan: "Scale", account: "Maison Dubois" },
      },
      {
        id: "pw-40512",
        name: "Diego Ramos",
        email: mailbox("diego.ramos"),
        context: { plan: "Starter", account: "Ramos Outdoor" },
      },
    ],
  },
];

export function findSite(slug: string): Site | undefined {
  return SITES.find((site) => site.slug === slug);
}
