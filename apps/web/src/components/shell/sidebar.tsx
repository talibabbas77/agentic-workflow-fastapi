"use client";

import type { Me } from "@docent/api-client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { isActive, mainNav, settingsNav, type NavItem } from "./nav";
import { InboxBadge } from "./notifications";
import { WorkspaceSwitcher } from "./workspace-switcher";

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-3 rounded-md px-2.5 text-base transition-colors duration-150",
        active ? "bg-rust-soft font-medium text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4.5 shrink-0", active ? "text-rust" : "text-ink-muted group-hover:text-ink")}
        weight={active ? "fill" : "regular"}
      />
      {item.label}
      {item.href === "/app/inbox" ? <InboxBadge /> : null}
    </Link>
  );
}

export function SidebarContent({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-5">
        <Link href="/app" onClick={onNavigate} className="-m-1 rounded-sm p-1" aria-label="Docent overview">
          <Logo title="" />
        </Link>
      </div>
      <div className="px-3 pt-2 pb-4">
        <WorkspaceSwitcher me={me} />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col overflow-y-auto px-3">
        <ul className="flex flex-col gap-0.5">
          {mainNav.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <ul className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3 pb-4">
          <li>
            <NavLink item={settingsNav} pathname={pathname} onNavigate={onNavigate} />
          </li>
        </ul>
      </nav>
    </div>
  );
}
