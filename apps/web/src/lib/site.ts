/**
 * Public addresses for the marketing site. The defaults are placeholders until the domain
 * is chosen. An empty value counts as unset, since Docker build arguments are never missing.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://docent.example").replace(/\/$/, "");
export const WIDGET_ORIGIN = (process.env.NEXT_PUBLIC_WIDGET_ORIGIN || "https://widget.docent.example").replace(
  /\/$/,
  "",
);
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@docent.example";

/**
 * The live showcase: two demo sites we built with the widget installed (apps/demo-host).
 * One for anonymous visitors, one for signed-in customers. Locally, run `pnpm demo-host`.
 */
export const SHOWCASE_PUBLIC_URL = process.env.NEXT_PUBLIC_SHOWCASE_PUBLIC_URL || "http://localhost:5173/lumen-notes";
export const SHOWCASE_APP_URL = process.env.NEXT_PUBLIC_SHOWCASE_APP_URL || "http://localhost:5173/parcelwise";

/** A public showcase turns sign-ups off and points visitors at the live demos instead. */
export const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN !== "false";

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
      { href: "/security", label: "Security" },
      { href: "/signup", label: "Start free trial" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Install guide" },
      { href: "/docs#identified", label: "Signed-in customers" },
      { href: "/docs#open", label: "Open the chat" },
      { href: "/docs#claims", label: "Token claims" },
      { href: "/docs#csp", label: "Content Security Policy" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/login", label: "Log in" },
    ],
  },
];

export type SocialPlatform = "x" | "linkedin" | "github" | "youtube" | "discord" | "instagram";

/**
 * Social profiles, set per deployment. A platform appears only once its URL is
 * set, so the site never links to an account that is not ours. Set a variable
 * to an empty string to hide it. Each one is read by name so Next can inline it.
 */
export const socialLinks = (
  [
    { platform: "x", label: "X", href: process.env.NEXT_PUBLIC_SOCIAL_X },
    { platform: "linkedin", label: "LinkedIn", href: process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN },
    {
      platform: "github",
      label: "GitHub",
      href: process.env.NEXT_PUBLIC_SOCIAL_GITHUB ?? "https://github.com/talibabbas77/agentic-workflow-fastapi",
    },
    { platform: "youtube", label: "YouTube", href: process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE },
    { platform: "discord", label: "Discord", href: process.env.NEXT_PUBLIC_SOCIAL_DISCORD },
    { platform: "instagram", label: "Instagram", href: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM },
  ] satisfies { platform: SocialPlatform; label: string; href: string | undefined }[]
).filter((link): link is { platform: SocialPlatform; label: string; href: string } => Boolean(link.href));
