"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const noop = () => () => {};

/** True after hydration. The stored theme is only known in the browser. */
function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/**
 * Light and dark switch for the marketing header and its small-screen menu.
 *
 * next-themes puts the .dark class on <html> before the first paint, so the
 * icon and the accessible name are chosen by CSS from that class: the right
 * one shows at once, with no flash and no shift. After hydration the button
 * also carries an explicit aria-label with the same words. The moon and sun
 * icons come from the server header, so their paths are not in the
 * script bundle.
 */
export function ThemeSwitch({ icons, variant = "icon" }: { icons: ReactNode; variant?: "icon" | "row" }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const label = mounted ? (resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme") : undefined;

  function toggle() {
    const dark = document.documentElement.classList.contains("dark");
    setTheme(dark ? "light" : "dark");
  }

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-md text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
      >
        <span className="dark:hidden">Dark theme</span>
        <span className="hidden dark:inline">Light theme</span>
        {icons}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-ink-muted",
        "transition-colors duration-150 hover:border-line hover:bg-surface-2 hover:text-ink",
      )}
    >
      {icons}
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <span className="sr-only hidden dark:inline">Switch to light theme</span>
    </button>
  );
}
