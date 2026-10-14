/** The platform admin console's pages, in the order of the tabs under its header. */
export const consoleNav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/billing-events", label: "Billing events" },
] as const;

export function isConsoleActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
