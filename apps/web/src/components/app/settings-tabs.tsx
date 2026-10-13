"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { settingsPages } from "@/components/shell/nav";
import { cn } from "@/lib/cn";

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="border-b border-line">
      <ul className="-mb-px flex gap-6">
        {settingsPages.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center border-b-2 text-base transition-colors duration-150",
                  active
                    ? "border-rust font-medium text-ink"
                    : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
