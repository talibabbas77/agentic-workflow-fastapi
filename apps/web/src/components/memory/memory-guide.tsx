import { cn } from "@/lib/cn";
import type { BranchId } from "./map-layout";
import { branchIcon, branchLabel } from "./memory-meta";

const guide: { branch: BranchId; from: string; keep: string }[] = [
  {
    branch: "knowledge",
    from: "Your help articles, files, and web pages from Knowledge, split into passages it can search and cite.",
    keep: "Kept until you remove the source.",
  },
  {
    branch: "answers",
    from: "Questions and answers your team writes here, for what your sources do not cover.",
    keep: "Kept until you delete them.",
  },
  {
    branch: "customers",
    from: "Short facts about signed-in customers, written after their conversations. Read as notes, never quoted.",
    keep: "Each fact is kept for 90 days.",
  },
  {
    branch: "gaps",
    from: "Product questions it could not answer and handed to your team.",
    keep: "Open until you answer or dismiss them.",
  },
];

/** What each part of the map is, where it comes from, and how long it lasts. */
export function MemoryGuide() {
  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <h3 className="text-md text-ink">What the agent remembers</h3>
      <dl className="flex flex-col gap-4">
        {guide.map(({ branch, from, keep }) => {
          const Icon = branchIcon[branch];
          return (
            <div key={branch} className="flex flex-col gap-0.5">
              <dt className="flex items-center gap-3 font-medium text-ink">
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-md border",
                    branch === "gaps" ? "border-rust/40 bg-rust-soft text-rust" : "border-line bg-paper text-ink-muted",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                {branchLabel[branch]}
              </dt>
              <dd className="pl-10 text-sm text-ink-muted">
                {from} <span className="text-ink">{keep}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="border-t border-line pt-4 text-sm text-ink">
        Answers only ever come from your sources and team answers, and each one cites them. Within a conversation, the
        agent also reads the last few messages.
      </p>
    </div>
  );
}
