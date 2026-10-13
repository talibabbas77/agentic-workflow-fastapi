import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { legalNav } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-3">
          <Logo className="self-start" />
          <p className="text-sm text-ink-muted">Support answers from your docs, with the page they came from.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {legalNav.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="rounded-sm text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
