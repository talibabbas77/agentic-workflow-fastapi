"use client";

import type { GapGroup, MemoryOverview, RememberedCustomer, TeamAnswer } from "@docent/api-client";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatCount, plural } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { CitedSections } from "./cited-sections";
import { CustomerMemory } from "./customer-memory";
import { KnowledgeGaps } from "./knowledge-gaps";
import type { BranchId } from "./map-layout";
import { MemoryGuide } from "./memory-guide";
import { MemoryMap } from "./memory-map";
import { BUSY_ANSWER } from "./memory-meta";
import { TeamAnswerDialog } from "./team-answer-dialog";
import { TeamAnswers } from "./team-answers";

type TabId = Exclude<BranchId, "knowledge">;

export type MemoryData = {
  overview: MemoryOverview;
  answers: TeamAnswer[];
  gaps: GapGroup[];
  customers: RememberedCustomer[];
};

/**
 * The memory page. Starts from server data and refreshes the part that changed
 * after each edit; it polls only while a team answer is being indexed.
 */
export function MemoryManager({ initial, canManage }: { initial: MemoryData; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [overview, setOverview] = useState(initial.overview);
  const [answers, setAnswers] = useState(initial.answers);
  const [gaps, setGaps] = useState(initial.gaps);
  const [customers, setCustomers] = useState(initial.customers);
  const [tab, setTab] = useState<TabId>("answers");
  const [dialogOpen, setDialogOpen] = useState(false);
  // A new key per opening gives the dialog fresh state each time.
  const [dialogKey, setDialogKey] = useState(0);
  const [editing, setEditing] = useState<TeamAnswer | null>(null);
  const [answering, setAnswering] = useState<GapGroup | null>(null);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());
  const tabsRef = useRef<HTMLDivElement>(null);
  const citedRef = useRef<HTMLElement>(null);

  const refreshOverview = useCallback(async () => {
    const result = await request(api.GET("/v1/memory"));
    if (result.ok) setOverview(result.data);
  }, []);
  const refreshAnswers = useCallback(async () => {
    const result = await request(api.GET("/v1/memory/answers"));
    if (result.ok) setAnswers(result.data);
  }, []);
  const refreshGaps = useCallback(async () => {
    const result = await request(api.GET("/v1/memory/gaps"));
    if (result.ok) setGaps(result.data);
  }, []);
  const refreshCustomers = useCallback(async () => {
    const result = await request(api.GET("/v1/memory/customers"));
    if (result.ok) setCustomers(result.data);
  }, []);

  usePoll(
    answers.some((answer) => BUSY_ANSWER.has(answer.status)),
    refreshAnswers,
  );

  function openDialog(answer: TeamAnswer | null, gap: GapGroup | null) {
    setEditing(answer);
    setAnswering(gap);
    setDialogKey((n) => n + 1);
    setDialogOpen(true);
  }

  /** Scroll a part of the page into view and move focus there. */
  function reveal(target: HTMLElement | null | undefined, focus: HTMLElement | null | undefined = target) {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    focus?.focus({ preventScroll: true });
  }

  function selectFromMap(branch: BranchId, leaf: string | null) {
    if (branch === "knowledge") {
      if (leaf) router.push(`/app/knowledge/${leaf}`);
      else reveal(citedRef.current);
      return;
    }
    setTab(branch);
    reveal(tabsRef.current, tabRefs.current.get(branch));
  }

  // Short labels keep all three tabs in view on a phone.
  const tabs: { id: TabId; label: string; short: string; count: number }[] = [
    { id: "answers", label: "Team answers", short: "Answers", count: overview.team_answers },
    { id: "gaps", label: "Knowledge gaps", short: "Gaps", count: overview.open_gaps },
    { id: "customers", label: "Customer memory", short: "Customers", count: overview.customers_remembered },
  ];

  // Arrow keys move between tabs, as the tabs pattern expects.
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length]!.id;
    setTab(next);
    tabRefs.current.get(next)?.focus();
  }

  const stats = [
    { label: "Answers, last 30 days", value: overview.answers_30d },
    { label: "Handoffs, last 30 days", value: overview.handoffs_30d },
    { label: "Team answers", value: overview.team_answers },
    { label: "Open gaps", value: overview.open_gaps, rust: overview.open_gaps > 0 },
    { label: "Customers remembered", value: overview.customers_remembered },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Memory"
        description="What the agent knows, what it remembers about your customers, and what it could not answer. Your docs and team answers are the only things it answers from."
      />

      <Card aria-labelledby="map-heading">
        <CardHeader>
          <CardTitle id="map-heading">Memory map</CardTitle>
          <CardDescription>
            Everything the agent draws on, arranged around it. Select a part to open its list below.
          </CardDescription>
        </CardHeader>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="flex min-w-0 flex-col justify-center px-4 py-6 sm:px-8 sm:py-8">
            <MemoryMap
              overview={overview}
              answers={answers}
              gaps={gaps}
              customers={customers}
              onSelect={selectFromMap}
            />
          </div>
          <div className="border-t border-line lg:border-t-0 lg:border-l">
            <MemoryGuide />
          </div>
        </div>
      </Card>

      <Card aria-label="Memory totals" className="overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-line lg:grid-cols-5">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={cn(
                "flex flex-col gap-1 bg-surface px-6 py-5",
                index === stats.length - 1 && "col-span-2 lg:col-span-1",
              )}
            >
              <dt className="text-sm text-ink-muted">{stat.label}</dt>
              <dd className={cn("text-2xl font-semibold tabular-nums", stat.rust ? "text-rust" : "text-ink")}>
                {formatCount(stat.value)}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <CitedSections ref={citedRef} sections={overview.top_sections} />

      <section aria-label="Memory lists" className="flex flex-col gap-6">
        <div
          ref={tabsRef}
          role="tablist"
          aria-label="Memory lists"
          className="flex scroll-mt-20 gap-6 overflow-x-auto border-b border-line"
        >
          {tabs.map((t, index) => (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el);
                else tabRefs.current.delete(t.id);
              }}
              type="button"
              role="tab"
              id={`memory-${t.id}-tab`}
              aria-selected={tab === t.id}
              aria-controls={`memory-${t.id}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(event) => onTabKey(event, index)}
              className={cn(
                "-mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 text-base whitespace-nowrap transition-colors duration-150",
                tab === t.id
                  ? "border-rust font-medium text-ink"
                  : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
              )}
            >
              <span className="sm:hidden">{t.short}</span>
              <span className="max-sm:hidden">{t.label}</span>
              <Badge tone={t.id === "gaps" && t.count > 0 ? "accent" : "neutral"} className="tabular-nums">
                {formatCount(t.count)}
              </Badge>
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`memory-${tab}-panel`} aria-labelledby={`memory-${tab}-tab`}>
          {tab === "answers" ? (
            <TeamAnswers
              answers={answers}
              canManage={canManage}
              onAdd={() => openDialog(null, null)}
              onEdit={(answer) => openDialog(answer, null)}
              onDeleted={(answer) => {
                setAnswers((list) => list.filter((a) => a.id !== answer.id));
                toast({ tone: "success", title: "Team answer deleted", description: answer.question });
                void refreshOverview();
              }}
            />
          ) : tab === "gaps" ? (
            <KnowledgeGaps
              gaps={gaps}
              canManage={canManage}
              onAnswer={(gap) => openDialog(null, gap)}
              onDismissed={(gap) => {
                setGaps((list) => list.filter((g) => g !== gap));
                toast({
                  tone: "success",
                  title: gap.count === 1 ? "Question dismissed" : `${gap.count} questions dismissed`,
                });
                void refreshOverview();
              }}
            />
          ) : (
            <CustomerMemory
              customers={customers}
              canManage={canManage}
              onChanged={() => {
                void refreshCustomers();
                void refreshOverview();
              }}
            />
          )}
        </div>
      </section>

      {canManage ? (
        <TeamAnswerDialog
          key={dialogKey}
          open={dialogOpen}
          editing={editing}
          gap={answering}
          onClose={() => setDialogOpen(false)}
          onSaved={(saved) => {
            setDialogOpen(false);
            setAnswers((list) => [saved, ...list.filter((a) => a.id !== saved.id)]);
            if (answering) {
              setGaps((list) => list.filter((g) => g !== answering));
              void refreshGaps();
            }
            toast({
              tone: "success",
              title: editing ? "Team answer saved" : "Team answer added",
              description: answering
                ? `${formatCount(answering.count)} ${plural(answering.count, "question")} closed. The agent can use it within a minute.`
                : "The agent can use it within a minute.",
            });
            void refreshOverview();
          }}
        />
      ) : null}
    </div>
  );
}
