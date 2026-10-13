import type { ReactNode } from "react";

/*
 * Small flat line drawings for empty states. Ink lines use currentColor, the
 * one accent is rust. Shapes that overlap are filled with the card surface.
 */

function Frame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      width="160"
      height="120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      className="h-auto w-36 sm:w-40"
    >
      {children}
    </svg>
  );
}

const rust = { fill: "var(--rust)", stroke: "none" } as const;
const card = { fill: "var(--surface)" } as const;

export function InboxIllustration() {
  return (
    <Frame label="A message landing in an inbox tray">
      <path d="M24 66 40 40h80l16 26v30a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4Z" />
      <rect x="52" y="16" width="56" height="42" rx="4" style={card} />
      <path d="M61 29h30M61 37h38M61 45h22" />
      <path d="M97 12h9v17l-4.5-4.5L97 29Z" style={rust} />
      <path
        d="M24 66h34a5 5 0 0 1 5 5v1a6 6 0 0 0 6 6h22a6 6 0 0 0 6-6v-1a5 5 0 0 1 5-5h34"
        style={card}
      />
    </Frame>
  );
}

export function WidgetIllustration() {
  return (
    <Frame label="A website with a chat widget in the corner">
      <rect x="18" y="20" width="124" height="82" rx="4" />
      <path d="M18 33h124" />
      <circle cx="27" cy="26.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="33" cy="26.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="39" cy="26.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M30 46h44M30 54h52M30 62h36" />
      <rect x="90" y="42" width="42" height="34" rx="4" style={card} />
      <path d="M98 52h22M98 60h26M98 68h14" />
      <circle cx="125" cy="90" r="6" style={rust} />
    </Frame>
  );
}

export function TicketTypesIllustration() {
  return (
    <Frame label="Three labels for different kinds of requests">
      <path d="M38 22h52l12 11-12 11H38a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4Z" />
      <circle cx="44" cy="33" r="2.5" />
      <path d="M52 33h30" />
      <path d="M50 50h60l12 11-12 11H50a4 4 0 0 1-4-4V54a4 4 0 0 1 4-4Z" style={card} />
      <circle cx="56" cy="61" r="2.5" style={rust} />
      <path d="M64 61h36" />
      <path d="M38 80h44l12 11-12 11H38a4 4 0 0 1-4-4V84a4 4 0 0 1 4-4Z" />
      <circle cx="44" cy="91" r="2.5" />
      <path d="M52 91h22" />
    </Frame>
  );
}

export function EvalsIllustration() {
  return (
    <Frame label="A checklist of test questions">
      <rect x="40" y="16" width="80" height="90" rx="4" />
      <rect x="64" y="11" width="32" height="10" rx="3" style={card} />
      <rect x="52" y="34" width="12" height="12" rx="2" />
      <path d="m55 40 2.5 2.5L62 37.5" stroke="var(--rust)" strokeWidth="2" />
      <path d="M72 40h36" />
      <rect x="52" y="56" width="12" height="12" rx="2" />
      <path d="m55 62 2.5 2.5L62 59.5" />
      <path d="M72 62h30" />
      <rect x="52" y="78" width="12" height="12" rx="2" />
      <path d="M72 84h24" />
    </Frame>
  );
}

export function UsageIllustration() {
  return (
    <Frame label="A bar chart under a fixed monthly cap">
      <path d="M26 98h110" />
      <rect x="36" y="74" width="12" height="24" rx="1.5" />
      <rect x="56" y="62" width="12" height="36" rx="1.5" />
      <rect x="76" y="68" width="12" height="30" rx="1.5" />
      <rect x="96" y="52" width="12" height="46" rx="1.5" />
      <rect x="116" y="58" width="12" height="40" rx="1.5" />
      <path d="M26 38h110" stroke="var(--rust)" strokeDasharray="4 4" />
      <circle cx="26" cy="38" r="3" style={rust} />
    </Frame>
  );
}
