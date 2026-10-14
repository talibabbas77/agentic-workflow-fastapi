import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { footerNav } from "@/lib/site";
import { container } from "./section";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className={`${container} pt-14 pb-10 sm:pt-16`}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-12">
          <div className="flex flex-col gap-4 lg:col-span-6">
            <Link href="/" aria-label="Docent home" className="-m-1 self-start rounded-sm p-1">
              <Logo title="" />
            </Link>
            <p className="max-w-[36ch] text-base text-ink-muted">
              A support agent that answers from the docs you teach it, cites the page it used, and hands the rest to
              your team.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 lg:col-span-5 lg:col-start-8">
            {footerNav.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <h2 className="text-sm font-medium tracking-normal text-ink">{group.title}</h2>
                <ul className="flex flex-col gap-2.5">
                  {group.links.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="rounded-sm text-base text-ink-muted transition-colors duration-150 hover:text-ink"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © <Year /> Docent
          </p>
          <p>Made for teams that answer from their docs</p>
        </div>
      </div>
    </footer>
  );
}

async function Year() {
  "use cache";
  return new Date().getUTCFullYear();
}
