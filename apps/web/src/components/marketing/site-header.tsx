import { ListIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { marketingNav } from "@/lib/site";

const navLink =
  "rounded-sm text-base text-ink-muted transition-colors duration-150 hover:text-ink";

/** Marketing header. The small-screen menu is a native <details>, so it needs no script. */
export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-10 px-4 sm:px-8">
        <Link href="/" aria-label="Docent home" className="-m-1 rounded-sm p-1">
          <Logo title="" />
        </Link>
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-7">
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
          <ButtonLink href="/login" variant="ghost" size="sm" className="max-sm:hidden">
            Log in
          </ButtonLink>
          <ButtonLink href="/signup" size="sm">
            Start free trial
          </ButtonLink>
          <details className="group relative md:hidden">
            <summary
              aria-label="Menu"
              className="inline-flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink [&::-webkit-details-marker]:hidden"
            >
              <ListIcon aria-hidden="true" className="size-4.5" />
            </summary>
            <nav
              aria-label="Menu"
              className="absolute top-full right-0 z-30 mt-2 flex w-56 flex-col rounded-md border border-line bg-surface p-1"
            >
              {[...marketingNav, { href: "/login", label: "Log in" }].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-sm px-3 py-2 text-base text-ink transition-colors duration-150 hover:bg-surface-2"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
