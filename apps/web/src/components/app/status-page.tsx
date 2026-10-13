import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

/** Full-page message used by not-found and error boundaries outside the app shell. */
export function StatusPage({
  code,
  title,
  children,
  actions,
}: {
  code?: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-10 sm:py-8">
      <Logo className="self-start" />
      <main className="flex flex-1 items-center justify-center py-16">
        <div className="fade-in flex w-full max-w-[28rem] flex-col gap-4">
          {code ? <p className="font-display text-4xl font-semibold text-rust tabular">{code}</p> : null}
          <h1 className="font-display text-3xl text-ink">{title}</h1>
          <div className="text-md text-ink-muted">{children}</div>
          <div className="mt-2 flex flex-wrap gap-3">{actions}</div>
        </div>
      </main>
    </div>
  );
}
