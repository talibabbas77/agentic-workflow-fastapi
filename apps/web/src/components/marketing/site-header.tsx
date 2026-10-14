import { ArrowRightIcon, ListIcon, MoonIcon, SunIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { marketingNav } from "@/lib/site";
import { ThemeSwitch } from "./theme-switch";

/** Moon in light mode (switch to dark), sun in dark mode. Chosen by CSS from the .dark class, so it never flashes. */
const themeIcons = (
  <>
    <MoonIcon aria-hidden="true" className="size-4.5 shrink-0 dark:hidden" />
    <SunIcon aria-hidden="true" className="hidden size-4.5 shrink-0 dark:block" />
  </>
);

const navLink =
  "rounded-sm px-1 py-1 text-base text-ink-muted transition-colors duration-150 hover:text-ink";

/**
 * Marketing header. It sticks to the top and fills with paper and a hairline
 * once the page scrolls (pure CSS, see .mk-header). The small-screen menu is a
 * native <details>, so it needs no script.
 */
export function SiteHeader() {
  return (
    <header className="mk-header sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-10 px-4 sm:px-8">
        <Link href="/" aria-label="Docent home" className="-m-1 rounded-sm p-1">
          <Logo title="" />
        </Link>
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-6">
            {marketingNav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={navLink}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:block">
            <ThemeSwitch icons={themeIcons} />
          </div>
          <ButtonLink href="/login" variant="ghost" size="sm" className="max-sm:hidden">
            Log in
          </ButtonLink>
          <ButtonLink href="/signup" size="sm">
            Start free trial
          </ButtonLink>
          <details className="group relative md:hidden">
            <summary
              aria-label="Menu"
              className="inline-flex size-9 cursor-pointer list-none items-center justify-center rounded-md border border-transparent text-ink-muted transition-colors duration-150 group-open:border-line group-open:bg-surface group-open:text-ink hover:bg-surface-2 hover:text-ink [&::-webkit-details-marker]:hidden"
            >
              <ListIcon aria-hidden="true" className="size-4.5 group-open:hidden" />
              <XIcon aria-hidden="true" className="hidden size-4.5 group-open:block" />
            </summary>
            <nav
              aria-label="Menu"
              className="absolute top-full right-0 z-30 mt-2 flex w-[min(18rem,calc(100vw-2rem))] flex-col rounded-lg border border-line-strong bg-surface p-2"
            >
              <ul className="flex flex-col">
                {marketingNav.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="flex items-center justify-between rounded-md px-3 py-2.5 text-md text-ink transition-colors duration-150 hover:bg-surface-2"
                    >
                      {item.label}
                      <ArrowRightIcon aria-hidden="true" className="size-4 text-ink-muted" />
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-col border-t border-line pt-2">
                <ThemeSwitch icons={themeIcons} variant="row" />
                <a
                  href="/login"
                  className="flex items-center rounded-md px-3 py-2.5 text-md text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
                >
                  Log in
                </a>
              </div>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
