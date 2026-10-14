import {
  BookOpenTextIcon,
  BrainIcon,
  ChatCircleTextIcon,
  CodeIcon,
  CreditCardIcon,
  ExamIcon,
  GearSixIcon,
  HeadsetIcon,
  HouseIcon,
  TrayIcon,
  type Icon,
} from "@phosphor-icons/react";

export type NavItem = { href: string; label: string; icon: Icon };

export const mainNav: NavItem[] = [
  { href: "/app", label: "Overview", icon: HouseIcon },
  { href: "/app/inbox", label: "Inbox", icon: TrayIcon },
  // Setup order: teach the agent, try it, decide what a handoff collects, then install.
  // Memory sits next to Knowledge: both are what the agent knows.
  { href: "/app/knowledge", label: "Knowledge", icon: BookOpenTextIcon },
  { href: "/app/memory", label: "Memory", icon: BrainIcon },
  { href: "/app/agent", label: "Agent", icon: ChatCircleTextIcon },
  { href: "/app/handoffs", label: "Handoffs", icon: HeadsetIcon },
  { href: "/app/widgets", label: "Widgets", icon: CodeIcon },
  { href: "/app/evals", label: "Evals", icon: ExamIcon },
  { href: "/app/billing", label: "Billing", icon: CreditCardIcon },
];

export const settingsNav: NavItem = { href: "/app/settings", label: "Settings", icon: GearSixIcon };

/** The pages under Settings, shown as tabs and in the top bar trail. */
export const settingsPages = [
  { href: "/app/settings", label: "Workspace" },
  { href: "/app/settings/members", label: "Members" },
];

export function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Title for the top bar, as a short trail: ["Settings", "Members"]. */
export function titleFor(pathname: string): string[] {
  const settingsPage = settingsPages.find((page) => page.href === pathname);
  if (settingsPage) return [settingsNav.label, settingsPage.label];
  const item = mainNav.find((entry) => entry.href !== "/app" && isActive(pathname, entry.href));
  return [item?.label ?? "Overview"];
}
