"use client";

import type { Me } from "@docent/api-client";
import { ListIcon, XIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { titleFor } from "./nav";
import { SidebarContent } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const trail = titleFor(pathname);
  const closeDrawer = () => drawer.current?.close();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md border border-line-strong bg-surface px-3 py-2 text-base font-medium text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh border-r border-line lg:block">
        <SidebarContent me={me} />
      </aside>

      <dialog
        ref={drawer}
        aria-label="Navigation"
        className="drawer fixed inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-line bg-paper p-0 text-ink"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
      >
        <button
          type="button"
          onClick={closeDrawer}
          aria-label="Close navigation"
          className="absolute top-2.5 right-2.5 z-10 inline-flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
        >
          <XIcon aria-hidden="true" className="size-[1.125rem]" />
        </button>
        <SidebarContent me={me} onNavigate={closeDrawer} />
      </dialog>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-paper">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-8 lg:px-10">
          <button
            type="button"
            onClick={() => drawer.current?.showModal()}
            aria-label="Open navigation"
            className="-ml-2 inline-flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <ListIcon aria-hidden="true" className="size-5" />
          </button>
          <p className="flex min-w-0 items-center gap-2 text-md">
            {trail.map((part, index) => (
              <span key={part} className="flex min-w-0 items-center gap-2">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-ink-subtle">
                    /
                  </span>
                ) : null}
                <span className={index === trail.length - 1 ? "truncate font-medium text-ink" : "text-ink-muted"}>
                  {part}
                </span>
              </span>
            ))}
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <UserMenu me={me} />
          </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
