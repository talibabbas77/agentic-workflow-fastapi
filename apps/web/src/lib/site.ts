/** Public addresses for the marketing site. The defaults are placeholders until the domain is chosen. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://docent.example").replace(/\/$/, "");
export const WIDGET_ORIGIN = (process.env.NEXT_PUBLIC_WIDGET_ORIGIN ?? "https://widget.docent.example").replace(
  /\/$/,
  "",
);
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@docent.example";

/** Marketing pages, in navigation order. Used by the header, footer, and sitemap. */
export const marketingNav = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
];

export const legalNav = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/security", label: "Security" },
  { href: "/contact", label: "Contact" },
];

/** Footer columns. */
export const footerNav = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/docs", label: "Docs" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];
