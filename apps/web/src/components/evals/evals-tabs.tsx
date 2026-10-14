"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export const evalTabs = [
  { href: "/app/evals", label: "Sets" },
  { href: "/app/evals/runs", label: "Runs" },
  { href: "/app/evals/compare", label: "Compare" },
  { href: "/app/evals/metrics", label: "Metrics" },
  { href: "/app/evals/review", label: "Review" },
  { href: "/app/evals/calibration", label: "Calibration" },
];

function isCurrent(pathname: string, href: string) {
  if (href === "/app/evals") return pathname === href || pathname.startsWith("/app/evals/sets");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The parts of Evals. Scrolls sideways on a phone rather than wrapping. */
export function EvalsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Evals" className="-mx-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      <ul className="-mb-px flex gap-6">
        {evalTabs.map((tab) => {
          const active = isCurrent(pathname, tab.href);
          return (
            <li key={tab.href} className="shrink-0">
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
