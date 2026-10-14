import {
  ArrowUpIcon,
  DiscordLogoIcon,
  EnvelopeSimpleIcon,
  GithubLogoIcon,
  InstagramLogoIcon,
  LinkedinLogoIcon,
  XLogoIcon,
  YoutubeLogoIcon,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { CONTACT_EMAIL, footerNav, type SocialPlatform, socialLinks } from "@/lib/site";
import { container } from "./section";

const socialIcons: Record<SocialPlatform, ReactNode> = {
  x: <XLogoIcon />,
  linkedin: <LinkedinLogoIcon />,
  github: <GithubLogoIcon />,
  youtube: <YoutubeLogoIcon />,
  discord: <DiscordLogoIcon />,
  instagram: <InstagramLogoIcon />,
};

const footerLink =
  "rounded-sm text-base text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:text-ink";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`${container} pt-14 sm:pt-20`}>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="flex flex-col gap-5 lg:col-span-4">
            <Link href="/" aria-label="Docent home" className="-m-1 self-start rounded-sm p-1">
              <Logo title="" />
            </Link>
            <p className="max-w-[38ch] text-base text-ink-muted">
              A support agent that answers from the docs you teach it, cites the page it used, and hands the rest to
              your team with a summary.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-2 self-start rounded-sm text-base font-medium text-ink transition-colors duration-150 hover:text-rust"
            >
              <EnvelopeSimpleIcon aria-hidden="true" className="size-4.5 text-ink-muted" />
              {CONTACT_EMAIL}
            </a>
            {socialLinks.length > 0 ? (
              <ul aria-label="Docent elsewhere" className="flex flex-wrap gap-2">
                {socialLinks.map((link) => (
                  <li key={link.platform}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex size-10 items-center justify-center rounded-md border border-line bg-paper text-lg text-ink-muted transition-colors duration-150 hover:border-line-strong hover:text-ink"
                    >
                      <span aria-hidden="true">{socialIcons[link.platform]}</span>
                      <span className="sr-only">Docent on {link.label} (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:col-span-7 lg:col-start-6">
            {footerNav.map((group) => (
              <div key={group.title} className="flex flex-col gap-4">
                <h2 className="text-sm font-medium tracking-normal text-ink">{group.title}</h2>
                <ul className="flex flex-col gap-3">
                  {group.links.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className={footerLink}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-line py-6 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © <Year /> Docent. Made for teams that answer from their docs.
          </p>
          <a
            href="#top"
            className="inline-flex items-center gap-1.5 self-start rounded-sm transition-colors duration-150 hover:text-ink sm:self-auto"
          >
            Back to top
            <ArrowUpIcon aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </div>

      <div aria-hidden="true" className={`${container} select-none pt-2 pb-10 sm:pb-14`}>
        <Logo title="" className="h-auto w-full min-w-0 text-line" />
      </div>
    </footer>
  );
}

async function Year() {
  "use cache";
  return new Date().getUTCFullYear();
}
