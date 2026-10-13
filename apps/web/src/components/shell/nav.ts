import {
  BookOpenTextIcon,
  ChartBarIcon,
  CodeIcon,
  ExamIcon,
  GearSixIcon,
  HouseIcon,
  TagIcon,
  TrayIcon,
  type Icon,
} from "@phosphor-icons/react";

export type NavItem = { href: string; label: string; icon: Icon };

export const mainNav: NavItem[] = [
  { href: "/app", label: "Overview", icon: HouseIcon },
  { href: "/app/inbox", label: "Inbox", icon: TrayIcon },
  { href: "/app/knowledge", label: "Knowledge", icon: BookOpenTextIcon },
  { href: "/app/widget", label: "Widget", icon: CodeIcon },
  { href: "/app/ticket-types", label: "Ticket types", icon: TagIcon },
  { href: "/app/evals", label: "Evals", icon: ExamIcon },
  { href: "/app/usage", label: "Usage", icon: ChartBarIcon },
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
