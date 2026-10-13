import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { AnswerFlow } from "@/components/workflow/answer-flow";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10 sm:py-8">
        <header>
          <Link href="/login" className="inline-block rounded-sm p-1 -m-1" aria-label="Docent">
            <Logo title="" />
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center py-12 sm:py-16">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
      </div>
      <aside
        aria-labelledby="how-docent-answers"
        className="hidden border-l border-line bg-surface lg:flex lg:items-center lg:justify-center lg:px-12 xl:px-16"
      >
        <div className="w-full max-w-[520px]">
          <h2 id="how-docent-answers" className="font-serif text-2xl text-ink">
            How Docent answers
          </h2>
          <AnswerFlow className="mt-10 [--wf-max:1.125px]" />
          <p className="mt-10 text-md text-ink-muted">
            Docent answers from the documents you teach it, cites the page behind every answer, and hands
            the conversation to your team when no source supports one.
          </p>
        </div>
      </aside>
    </div>
  );
}
