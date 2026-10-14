"use client";

import type { Me } from "@docent/api-client";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { consoleNav, isConsoleActive } from "./nav";

/**
 * The platform admin console's own frame: the same design system as the app,
 * a header that says plainly this is Docent's internal console, its pages as
 * tabs, and a way back to the app.
 */
export function AdminShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md border border-line-strong bg-surface px-3 py-2 text-base font-medium text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-paper">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-8 lg:px-10">
          <Link href="/admin" className="-m-1 shrink-0 rounded-sm p-1" aria-label="Admin console overview">
            <Logo title="" />
          </Link>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line-strong" />
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-md font-semibold tracking-[-0.01em] text-ink">Admin console</span>
            <Badge tone="accent" className="max-sm:hidden">
              Internal
            </Badge>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <ButtonLink href="/app" variant="ghost" size="sm" className="max-md:hidden">
              <ArrowLeftIcon aria-hidden="true" className="size-4" />
              Back to the app
            </ButtonLink>
            <ThemeToggle />
            <UserMenu me={me} place="console" />
          </div>
        </div>
        <nav aria-label="Console" className="mx-auto w-full max-w-7xl px-4 sm:px-8 lg:px-10">
          <ul className="-mb-px flex gap-5 overflow-x-auto sm:gap-6">
            {consoleNav.map((item) => {
              const active = isConsoleActive(pathname, item.href);
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-10 items-center border-b-2 text-base whitespace-nowrap transition-colors duration-150",
                      active
                        ? "border-rust font-medium text-ink"
                        : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-8 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
