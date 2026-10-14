// The two showcase sites. Both companies and every person here are fictional
// and match the seeded workspaces (apps/api/src/docent/seed/catalog.py).

export interface Suggestion {
  /** What the answer shows, for example "Cited answer" or "Handoff". */
  kind: string;
  question: string;
}

export interface Site {
  slug: string;
  name: string;
  /** anonymous: every visitor chats without signing in. identified: signed-in customers only. */
  mode: "anonymous" | "identified";
  summary: string;
}

export const LUMEN: Site = {
  slug: "lumen-notes",
  name: "Lumen Notes",
  mode: "anonymous",
  summary: "A notes app's public website and help center. Every visitor chats anonymously.",
};

export const PARCELWISE: Site = {
  slug: "parcelwise",
  name: "Parcelwise",
  mode: "identified",
  summary: "A shipping platform's customer dashboard. The chat appears after you sign in.",
};

export const SITES: Site[] = [LUMEN, PARCELWISE];

/** Questions the Lumen help center answers, one it does not, and a greeting. */
export const LUMEN_SUGGESTIONS: Suggestion[] = [
  { kind: "Cited answer", question: "How many devices can I use on the Free plan?" },
  { kind: "Cited answer", question: "I deleted a note last week. Can I still get it back?" },
  { kind: "Cited answer", question: "How do I export a note as a PDF?" },
  { kind: "Cited answer", question: "Can I get my money back if I cancel an annual Plus plan after two weeks?" },
  { kind: "Handoff", question: "Can I dictate notes by voice and have them transcribed?" },
  { kind: "Greeting", question: "Hi there!" },
];

/** Plan-aware questions first: the answer depends on who is signed in. */
export const PARCELWISE_SUGGESTIONS: Suggestion[] = [
  { kind: "From your plan", question: "What's my per-label fee?" },
  { kind: "From your plan", question: "How many API requests per second can we send?" },
  { kind: "Cited answer", question: "How long do I have to void a Larkspur Express label?" },
  { kind: "Handoff", question: "I want to talk to someone about my last invoice." },
];

export type Status = "delivered" | "in_transit" | "out_for_delivery" | "available_for_pickup" | "pre_transit" | "failure";

export interface Shipment {
  id: string;
  recipient: string;
  city: string;
  carrier: string;
  service: string;
  status: Status;
  /** Days before today. */
  created: number;
}

export interface ApiKey {
  name: string;
  key: string;
  kind: "Live" | "Test" | "Restricted";
  detail: string;
}

export interface Account {
  company: string;
  plan: "Starter" | "Growth" | "Scale";
  labelsThisMonth: number;
  inTransit: number;
  attention: number;
  balance: number;
  autoReload: boolean;
  shipments: Shipment[];
  voidable: { id: string; carrier: string; daysLeft: number }[];
  keys: ApiKey[];
}

export interface Persona {
  /** The customer's id in Parcelwise, the token's `sub` (see server.ts for public deployments). */
  id: string;
  name: string;
  email: string;
  /** Extra claims, sent under `ctx`. The widget keeps only the ones it allows. */
  context: Record<string, string>;
  account: Account;
}

const mailbox = (local: string) => `docent-${local}@mailinator.com`;

/** Price list from the Parcelwise help center (pricing-and-billing.md, rate-limits.md). */
export const PLANS = {
  Starter: { monthly: 0, perLabel: 0.08, rps: 20, burst: 40 },
  Growth: { monthly: 79, perLabel: 0.04, rps: 100, burst: 200 },
  Scale: { monthly: 299, perLabel: 0.02, rps: 300, burst: 600 },
} as const;

export const PERSONAS: Persona[] = [
  {
    id: "pw-31877",
    name: "Chloe Dubois",
    email: mailbox("chloe.dubois"),
    context: { plan: "Scale", account: "Maison Dubois" },
    account: {
      company: "Maison Dubois",
      plan: "Scale",
      labelsThisMonth: 4212,
      inTransit: 286,
      attention: 3,
      balance: 3480.2,
      autoReload: true,
      shipments: [
        { id: "PW-48231", recipient: "Hannah Becker", city: "Berlin, DE", carrier: "Bluecrest Post", service: "International priority", status: "in_transit", created: 0 },
        { id: "PW-48229", recipient: "Marcus Hill", city: "Brooklyn, NY", carrier: "Kestrel Courier", service: "Same day", status: "out_for_delivery", created: 0 },
        { id: "PW-48224", recipient: "Léa Tremblay", city: "Montréal, QC", carrier: "Larkspur Express", service: "2-day", status: "delivered", created: 1 },
        { id: "PW-48219", recipient: "Priya Shah", city: "Austin, TX", carrier: "Ridgeway Parcel", service: "Ground", status: "available_for_pickup", created: 2 },
        { id: "PW-48213", recipient: "Tom Ellis", city: "Leeds, UK", carrier: "Bluecrest Post", service: "International economy", status: "failure", created: 3 },
        { id: "PW-48207", recipient: "Olivia Chen", city: "Seattle, WA", carrier: "Larkspur Express", service: "Overnight", status: "delivered", created: 3 },
        { id: "PW-48199", recipient: "Sam Okoro", city: "Denver, CO", carrier: "Ridgeway Parcel", service: "Economy", status: "pre_transit", created: 4 },
      ],
      voidable: [
        { id: "PW-48199", carrier: "Ridgeway Parcel", daysLeft: 26 },
        { id: "PW-48188", carrier: "Larkspur Express", daysLeft: 9 },
      ],
      keys: [
        { name: "Storefront", key: "pw_live_4f2a", kind: "Live", detail: "Used 2 minutes ago" },
        { name: "Warehouse printer", key: "pw_live_91c0", kind: "Restricted", detail: "Labels only, 2 server IPs" },
        { name: "Staging", key: "pw_test_7d13", kind: "Test", detail: "Used yesterday" },
      ],
    },
  },
  {
    id: "pw-40512",
    name: "Diego Ramos",
    email: mailbox("diego.ramos"),
    context: { plan: "Starter", account: "Ramos Outdoor" },
    account: {
      company: "Ramos Outdoor",
      plan: "Starter",
      labelsThisMonth: 148,
      inTransit: 12,
      attention: 1,
      balance: 86.1,
      autoReload: false,
      shipments: [
        { id: "PW-51108", recipient: "Jake Morrison", city: "Boise, ID", carrier: "Ridgeway Parcel", service: "Ground", status: "in_transit", created: 0 },
        { id: "PW-51102", recipient: "Ana Lucero", city: "Santa Fe, NM", carrier: "Ridgeway Parcel", service: "Economy", status: "pre_transit", created: 1 },
        { id: "PW-51097", recipient: "Chris Walker", city: "Bend, OR", carrier: "Harborline Freight", service: "Heavy", status: "in_transit", created: 2 },
        { id: "PW-51090", recipient: "Megan Price", city: "Flagstaff, AZ", carrier: "Ridgeway Parcel", service: "Ground", status: "failure", created: 3 },
        { id: "PW-51084", recipient: "Luis Ortega", city: "Tucson, AZ", carrier: "Larkspur Express", service: "2-day", status: "delivered", created: 5 },
        { id: "PW-51079", recipient: "Rachel Kim", city: "Missoula, MT", carrier: "Ridgeway Parcel", service: "Ground", status: "delivered", created: 6 },
      ],
      voidable: [{ id: "PW-51102", carrier: "Ridgeway Parcel", daysLeft: 29 }],
      keys: [{ name: "Shop plugin", key: "pw_live_0b6e", kind: "Live", detail: "Used 1 hour ago" }],
    },
  },
  {
    id: "pw-52290",
    name: "Emma Wright",
    email: mailbox("emma.wright"),
    context: { plan: "Growth", account: "Wright Supplies" },
    account: {
      company: "Wright Supplies",
      plan: "Growth",
      labelsThisMonth: 1126,
      inTransit: 94,
      attention: 2,
      balance: 612.45,
      autoReload: true,
      shipments: [
        { id: "PW-50677", recipient: "Daniel Brooks", city: "Chicago, IL", carrier: "Kestrel Courier", service: "Same day", status: "delivered", created: 0 },
        { id: "PW-50671", recipient: "Grace Patel", city: "Toronto, ON", carrier: "Larkspur Express", service: "2-day", status: "in_transit", created: 0 },
        { id: "PW-50664", recipient: "Owen Fisher", city: "Columbus, OH", carrier: "Ridgeway Parcel", service: "Ground", status: "available_for_pickup", created: 1 },
        { id: "PW-50659", recipient: "Nora Hughes", city: "Raleigh, NC", carrier: "Ridgeway Parcel", service: "Ground", status: "out_for_delivery", created: 1 },
        { id: "PW-50652", recipient: "Victor Reyes", city: "Phoenix, AZ", carrier: "Ridgeway Parcel", service: "Economy", status: "failure", created: 2 },
        { id: "PW-50645", recipient: "Ella Sanders", city: "Portland, ME", carrier: "Larkspur Express", service: "Overnight", status: "delivered", created: 4 },
      ],
      voidable: [{ id: "PW-50638", carrier: "Larkspur Express", daysLeft: 6 }],
      keys: [
        { name: "Order sync", key: "pw_live_c3d8", kind: "Live", detail: "Used 5 minutes ago" },
        { name: "Sandbox", key: "pw_test_e41f", kind: "Test", detail: "Used 3 days ago" },
      ],
    },
  },
];

export const findPersona = (id: string): Persona | undefined => PERSONAS.find((p) => p.id === id);
