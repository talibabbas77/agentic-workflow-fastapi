"use client";

import type { EvalCase, EvalDocument, EvalRun, EvalSetDetail } from "@docent/api-client";
import {
  ArrowLeftIcon,
  CheckIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatCount, formatRelative, plural } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";
import { usePoll } from "@/lib/use-poll";
import { CaseDialog } from "./case-editor";
import { ACTIVE_RUN, expectedLabel, formatCost, formatPercent, RunStatusBadge } from "./eval-meta";
import { SetDialog } from "./set-dialog";

type Open = { kind: "case"; existing?: EvalCase } | { kind: "drafts" } | { kind: "edit" } | { kind: "delete" } | null;

/**
 * One eval set: its drafts waiting for approval, its cases, and its runs. Keeps
 * itself current while drafts are being written or a run is going.
 */
export function SetDetail({
  initial,
  documents,
  canManage,
}: {
  initial: EvalSetDetail;
  documents: EvalDocument[];
  canManage: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [open, setOpen] = useState<Open>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [starting, setStarting] = useState(false);
  const set = detail.set;
  const drafts = detail.cases.filter((c) => c.status === "draft");
  const cases = detail.cases.filter((c) => c.status === "active");
  const activeRun = detail.runs.find((r) => ACTIVE_RUN.has(r.status)) ?? null;
  const drafting = set.drafting.status === "running";

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/evals/sets/{set_id}", { params: { path: { set_id: set.id } } }));
    if (result.ok) setDetail(result.data);
  }, [set.id]);

  usePoll(drafting || activeRun !== null, refresh, 2500);

  const show = (next: NonNullable<Open>) => {
    setDialogKey((n) => n + 1);
    setOpen(next);
  };
  const close = (kind: NonNullable<Open>["kind"]) => () => setOpen((current) => (current?.kind === kind ? null : current));

  async function startRun() {
    setStarting(true);
    const result = await request(api.POST("/v1/evals/sets/{set_id}/runs", { params: { path: { set_id: set.id } } }));
    if (result.ok) {
      router.push(`/app/evals/runs/${result.data.id}`);
      return;
    }
    setStarting(false);
    toast({ tone: "error", title: "Could not start the run", description: result.error.message });
  }

  const finished = detail.runs.filter((r) => r.status === "succeeded" || r.status === "canceled");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/app/evals"
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          Sets
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="text-2xl break-words text-ink">{set.name}</h2>
            {set.description ? <p className="text-md text-ink-muted">{set.description}</p> : null}
            <p className="text-sm text-ink-muted tabular-nums">
              {formatCount(cases.length)} {plural(cases.length, "case")}
              {drafts.length > 0 ? `, ${formatCount(drafts.length)} ${plural(drafts.length, "draft")} to review` : ""}
            </p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={startRun}
                loading={starting}
                disabled={cases.length === 0 || activeRun !== null}
                icon={<PlayIcon aria-hidden="true" className="size-4" weight="fill" />}
              >
                Run eval
              </Button>
              <Button
                variant="secondary"
                onClick={() => show({ kind: "case" })}
                icon={<PlusIcon aria-hidden="true" className="size-4" />}
              >
                Add case
              </Button>
              <Button
                variant="secondary"
                onClick={() => show({ kind: "drafts" })}
                disabled={drafting}
                icon={<SparkleIcon aria-hidden="true" className="size-4" />}
              >
                Write drafts
              </Button>
              <PopoverMenu
                label="More for this set"
                align="end"
                className="w-44"
                trigger={(props) => (
                  <Button variant="ghost" size="icon" {...props} aria-label="More for this set">
                    <DotsThreeIcon aria-hidden="true" className="size-4.5" weight="bold" />
                  </Button>
                )}
              >
                {(closeMenu) => (
                  <>
                    <MenuItem
                      icon={<PencilSimpleIcon aria-hidden="true" className="size-4 text-ink-muted" />}
                      onClick={() => {
                        closeMenu();
                        show({ kind: "edit" });
                      }}
                    >
                      Edit set
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      className="text-rust"
                      icon={<TrashIcon aria-hidden="true" className="size-4" />}
                      onClick={() => {
                        closeMenu();
                        show({ kind: "delete" });
                      }}
                    >
                      Delete set
                    </MenuItem>
                  </>
                )}
              </PopoverMenu>
            </div>
          ) : null}
        </div>
      </div>

      {drafting ? (
        <Status>
          Writing drafts from your help articles: {set.drafting.written + set.drafting.skipped} of{" "}
          {set.drafting.requested}.
        </Status>
      ) : set.drafting.status === "failed" ? (
        <FormAlert>Writing drafts stopped: {set.drafting.error ?? "the model did not reply"}. Try again.</FormAlert>
      ) : null}
      {activeRun ? (
        <Status>
          A run is going: {activeRun.done_count} of {activeRun.case_count} cases.{" "}
          <Link href={`/app/evals/runs/${activeRun.id}`} className="font-medium text-rust underline underline-offset-[3px]">
            Watch it
          </Link>
        </Status>
      ) : null}

      {drafts.length > 0 ? (
        <DraftsCard
          setId={set.id}
          drafts={drafts}
          canManage={canManage}
          skipped={set.drafting.status === "idle" ? set.drafting.skipped : 0}
          onReview={(existing) => show({ kind: "case", existing })}
          onChanged={refresh}
        />
      ) : null}

      <Card aria-labelledby="cases-heading">
        <CardHeader>
          <CardTitle id="cases-heading">Cases</CardTitle>
          <CardDescription>Every run asks these, in this order.</CardDescription>
        </CardHeader>
        {cases.length === 0 ? (
          <p className="px-6 py-8 text-center text-base text-ink-muted">
            No cases yet. {canManage ? "Add one, or write drafts from your help articles and approve them." : null}
          </p>
        ) : (
          <ol aria-label="Cases">
            {cases.map((c, index) => (
              <CaseRow
                key={c.id}
                index={index}
                item={c}
                canManage={canManage}
                onEdit={() => show({ kind: "case", existing: c })}
                onDeleted={refresh}
              />
            ))}
          </ol>
        )}
      </Card>

      <Card aria-labelledby="runs-heading">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle id="runs-heading">Runs</CardTitle>
            <CardDescription>The latest 20. Each ran every approved case through the real agent.</CardDescription>
          </div>
          {finished.length >= 2 ? (
            <ButtonLink
              href={`/app/evals/compare?a=${finished[1]!.id}&b=${finished[0]!.id}`}
              variant="secondary"
              size="sm"
              className="self-start"
            >
              Compare the last two
            </ButtonLink>
          ) : null}
        </CardHeader>
        {detail.runs.length === 0 ? (
          <p className="px-6 py-8 text-center text-base text-ink-muted">Not run yet.</p>
        ) : (
          <RunRows runs={detail.runs} />
        )}
      </Card>

      <CaseDialog
        key={`case-${dialogKey}`}
        open={open?.kind === "case"}
        onClose={close("case")}
        setId={set.id}
        existing={open?.kind === "case" ? open.existing : undefined}
        documents={documents}
        onSaved={(saved) => {
          setOpen(null);
          toast({
            tone: "success",
            title: open?.kind === "case" && open.existing ? "Case saved" : "Case added",
            description: saved.status === "draft" ? "Still a draft." : undefined,
          });
          void refresh();
        }}
      />
      <DraftsDialog
        key={`drafts-${dialogKey}`}
        open={open?.kind === "drafts"}
        onClose={close("drafts")}
        setId={set.id}
        onStarted={(next) => {
          setOpen(null);
          setDetail((d) => ({ ...d, set: next }));
        }}
      />
      <SetDialog
        key={`edit-${dialogKey}`}
        open={open?.kind === "edit"}
        onClose={close("edit")}
        existing={set}
        onSaved={(saved) => {
          setOpen(null);
          setDetail((d) => ({ ...d, set: saved }));
          toast({ tone: "success", title: "Set saved" });
        }}
      />
      <DeleteSetDialog
        open={open?.kind === "delete"}
        onClose={close("delete")}
        setId={set.id}
        name={set.name}
        onDeleted={() => {
          toast({ tone: "success", title: "Set deleted", description: set.name });
          router.push("/app/evals");
        }}
      />
    </div>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="fade-in flex items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3.5 py-3 text-base text-ink"
    >
      <span aria-hidden="true" className="spinner text-xs text-rust" />
      <span>{children}</span>
    </p>
  );
}

function Who({ item }: { item: Pick<EvalCase, "identity"> }) {
  if (item.identity === null) return <span>Anonymous visitor</span>;
  const claims = Object.entries(item.identity);
  return (
    <span>
      Signed in
      {claims.length > 0 ? (
        <span className="font-mono text-ink">
          {" "}
          {claims.map(([k, v]) => `${k}=${v}`).join(", ")}
        </span>
      ) : null}
    </span>
  );
}

function CaseRow({
  index,
  item,
  canManage,
  onEdit,
  onDeleted,
}: {
  index: number;
  item: EvalCase;
  canManage: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    const result = await request(
      api.DELETE("/v1/evals/cases/{case_id}", { params: { path: { case_id: item.id } } }),
    );
    setDeleting(false);
    if (result.ok) {
      toast({ tone: "success", title: "Case deleted", description: "Past runs keep their copy." });
      onDeleted();
    } else {
      toast({ tone: "error", title: "Could not delete the case", description: result.error.message });
    }
  }

  return (
    <li className="flex items-start gap-4 border-b border-line px-6 py-4 last:border-b-0">
      <span className="mt-0.5 w-6 shrink-0 text-sm text-ink-subtle tabular-nums">{index + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p dir="auto" className="text-base break-words text-ink">
          {item.question}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
          <Badge tone={item.expected === "escalate" ? "accent" : "neutral"}>{expectedLabel[item.expected]}</Badge>
          <Who item={item} />
          {item.history.length > 0 ? (
            <span>
              {item.history.length} earlier {plural(item.history.length, "turn")}
            </span>
          ) : null}
          {item.gold_documents.length > 0 ? (
            <span className="min-w-0 truncate">Gold: {item.gold_documents.map((d) => d.title).join(", ")}</span>
          ) : null}
          {item.origin === "conversation" ? <span>From a conversation</span> : null}
          {item.origin === "generated" ? <span>Drafted from your articles</span> : null}
          {item.tags.map((tag) => (
            <Badge key={tag} tone="outline">
              {tag}
            </Badge>
          ))}
        </p>
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={`Edit case ${index + 1}`} onClick={onEdit}>
            <PencilSimpleIcon aria-hidden="true" className="size-4.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete case ${index + 1}`}
            loading={deleting}
            onClick={remove}
          >
            {deleting ? null : <TrashIcon aria-hidden="true" className="size-4.5" />}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function DraftsCard({
  setId,
  drafts,
  canManage,
  skipped,
  onReview,
  onChanged,
}: {
  setId: string;
  drafts: EvalCase[];
  canManage: boolean;
  skipped: number;
  onReview: (draft: EvalCase) => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"approve" | "discard" | null>(null);
  const ids = drafts.map((d) => d.id);
  const picked = ids.filter((id) => chosen.has(id));
  const all = picked.length === ids.length;

  async function act(kind: "approve" | "discard", caseIds: string[]) {
    setBusy(kind);
    const path = kind === "approve" ? "/v1/evals/sets/{set_id}/cases/approve" : "/v1/evals/sets/{set_id}/cases/discard";
    const result = await request(api.POST(path, { params: { path: { set_id: setId } }, body: { case_ids: caseIds } }));
    setBusy(null);
    if (!result.ok) {
      toast({ tone: "error", title: "Could not change the drafts", description: result.error.message });
      return;
    }
    const n = result.data.changed;
    toast({
      tone: "success",
      title: kind === "approve" ? `Approved ${n} ${plural(n, "draft")}` : `Discarded ${n} ${plural(n, "draft")}`,
    });
    setChosen(new Set());
    await onChanged();
  }

  return (
    <Card aria-labelledby="drafts-heading">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle id="drafts-heading">
            Drafts to review <span className="text-ink-muted tabular-nums">({drafts.length})</span>
          </CardTitle>
          <CardDescription>
            Written by the model from your passages. Each answer comes from its passage; check the question reads like a
            customer and approve the good ones.
            {skipped > 0 ? ` ${skipped} ${plural(skipped, "passage")} could not be turned into a trustworthy case.` : null}
          </CardDescription>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              loading={busy === "approve"}
              disabled={busy !== null}
              onClick={() => void act("approve", picked.length > 0 ? picked : ids)}
              icon={<CheckIcon aria-hidden="true" className="size-4" weight="bold" />}
            >
              {picked.length > 0 ? `Approve ${picked.length}` : "Approve all"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "discard"}
              disabled={busy !== null || picked.length === 0}
              onClick={() => void act("discard", picked)}
            >
              Discard{picked.length > 0 ? ` ${picked.length}` : ""}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      {canManage ? (
        <label className="flex items-center gap-3 border-b border-line px-6 py-2.5 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={all}
            onChange={() => setChosen(all ? new Set() : new Set(ids))}
            className="size-4 accent-rust"
          />
          Select all
        </label>
      ) : null}
      <ul aria-label="Drafts">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex items-start gap-3 border-b border-line px-6 py-4 last:border-b-0">
            {canManage ? (
              <input
                type="checkbox"
                aria-label={`Select: ${draft.question}`}
                checked={chosen.has(draft.id)}
                onChange={() =>
                  setChosen((current) => {
                    const next = new Set(current);
                    if (next.has(draft.id)) next.delete(draft.id);
                    else next.add(draft.id);
                    return next;
                  })
                }
                className="mt-1 size-4 shrink-0 accent-rust"
              />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p dir="auto" className="text-base break-words text-ink">
                {draft.question}
              </p>
              {draft.reference_answer ? (
                <p dir="auto" className="border-l-2 border-line-strong pl-3 text-sm break-words text-ink-muted">
                  {draft.reference_answer}
                </p>
              ) : null}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                {draft.gold_documents[0] ? <span>From {draft.gold_documents[0].title}</span> : null}
                {draft.identity !== null ? <span>Signed-in customers only</span> : null}
                {draft.must_include.length > 0 ? (
                  <span className="min-w-0">
                    Must include:{" "}
                    {draft.must_include.map((p) => (
                      <span key={p} className="mr-1 font-mono text-ink">
                        &ldquo;{p}&rdquo;
                      </span>
                    ))}
                  </span>
                ) : null}
              </p>
            </div>
            {canManage ? (
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onReview(draft)}>
                Review
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RunRows({ runs }: { runs: EvalRun[] }) {
  const now = useNow();
  return (
    <ul aria-label="Runs">
      {runs.map((run) => (
        <li key={run.id} className="border-b border-line last:border-b-0">
          <Link
            href={`/app/evals/runs/${run.id}`}
            className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-6 py-3.5 text-sm transition-colors duration-150 hover:bg-surface-2/60"
          >
            <span className="w-28 shrink-0 text-ink tabular-nums">{formatRelative(run.created_at, now)}</span>
            <RunStatusBadge status={run.status} />
            <span className={cn("text-ink-muted tabular-nums", !run.metrics && "sm:invisible")}>
              {formatPercent(run.metrics?.pass_rate)} passed
            </span>
            <span className={cn("text-ink-muted tabular-nums", !run.metrics && "sm:invisible")}>
              {formatPercent(run.metrics?.wrong_answer_rate)} wrong
            </span>
            <span className="text-ink-muted tabular-nums">
              {run.done_count} of {run.case_count} cases
            </span>
            <span className="text-ink-muted tabular-nums sm:ml-auto">{formatCost(run.cost_micros)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const DRAFT_COUNTS = [5, 10, 20, 30, 40, 50];

function DraftsDialog({
  open,
  onClose,
  setId,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  setId: string;
  onStarted: (set: EvalSetDetail["set"]) => void;
}) {
  const form = useApiForm();
  const [count, setCount] = useState(20);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await form.run(
      () =>
        request(
          api.POST("/v1/evals/sets/{set_id}/drafts", { params: { path: { set_id: setId } }, body: { count } }),
        ),
      onStarted,
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Write drafts from your help articles"
      description="The model reads passages across your documents and writes one customer question for each, with its answer from that passage."
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-4">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field label="How many" hint="Passages this set already uses are skipped." error={form.fieldError("count")}>
            <Select value={String(count)} onChange={(event) => setCount(Number(event.target.value))}>
              {DRAFT_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} drafts
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-ink-muted">
            A draft is kept only if its answer and required phrases come from its passage. Drafts arrive as you watch;
            runs use them once you approve them. Writing drafts uses the model, like a run does.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            Write drafts
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function DeleteSetDialog({
  open,
  onClose,
  setId,
  name,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  setId: string;
  name: string;
  onDeleted: () => void;
}) {
  const form = useApiForm();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Delete ${name}?`}
      description="Its cases and every run of it are deleted too. This cannot be undone."
    >
      <DialogBody>{form.formError ? <FormAlert>{form.formError}</FormAlert> : null}</DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={form.pending}
          onClick={() =>
            void form.run(
              () => request(api.DELETE("/v1/evals/sets/{set_id}", { params: { path: { set_id: setId } } })),
              onDeleted,
            )
          }
        >
          Delete set
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
