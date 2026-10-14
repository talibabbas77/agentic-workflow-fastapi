"use client";

import type { HandoffReason, InboxMessage, ReviewDetail, ReviewGrade } from "@docent/api-client";
import { ArrowLeftIcon, CheckIcon, XIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Transcript } from "@/components/inbox/transcript";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";
import { AddToEvalSet } from "./add-to-eval-set";
import { weekLabel } from "./review-queue";

const grades: { value: ReviewGrade; label: string; hint: string }[] = [
  { value: "right", label: "Right", hint: "The answers were correct and helped." },
  { value: "wrong", label: "Wrong", hint: "Marks the graded answer as wrong." },
];

/** One sampled conversation: read it, then grade it right or wrong. */
export function ReviewItemView({ initial, canManageEvals }: { initial: ReviewDetail; canManageEvals: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const now = useNow();
  const form = useApiForm();
  const [detail, setDetail] = useState(initial);
  const [grade, setGrade] = useState<ReviewGrade | null>(initial.item.grade);
  const [note, setNote] = useState(initial.item.note);
  const item = detail.item;
  const customer = item.claims.name ?? (item.mode === "identified" ? "Signed-in customer" : "Visitor");
  const handoff = detail.messages.find((m) => m.decision?.type === "escalate");
  const reason = (handoff?.decision?.reason ?? "no_source") as HandoffReason;

  async function save(next: boolean) {
    if (!form.check({ grade: !grade && "Choose right or wrong." })) return;
    await form.run(
      () =>
        request(
          api.PUT("/v1/evals/review/{item_id}", {
            params: { path: { item_id: item.id } },
            body: { grade, note: note.trim() },
          }),
        ),
      (saved) => {
        setDetail(saved);
        toast({ tone: "success", title: grade === "wrong" ? "Graded wrong" : "Graded right" });
        if (next && saved.next_id) router.push(`/app/evals/review/${saved.next_id}`);
        else if (next) router.push(`/app/evals/review?week=${item.week_start}`);
      },
    );
  }

  function onMessage(message: InboxMessage) {
    setDetail((d) => ({ ...d, messages: d.messages.map((m) => (m.id === message.id ? message : m)) }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/app/evals/review?week=${item.week_start}`}
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          {weekLabel(item.week_start, false)}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 dir="auto" className="text-2xl break-words text-ink">
              {item.question ?? "A conversation"}
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
              <span>{item.mode === "identified" ? "Signed-in customer" : "Anonymous visitor"}</span>
              <span className="tabular-nums">Started {formatRelative(item.started_at, now)}</span>
              {item.escalated ? <span>Handed off later</span> : null}
              {item.graded_by && item.graded_at ? (
                <span>
                  Graded by {item.graded_by}, {formatRelative(item.graded_at, now)}
                </span>
              ) : null}
            </p>
          </div>
          {canManageEvals ? <AddToEvalSet conversationId={item.conversation_id} messageId={item.message_id} /> : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card aria-labelledby="conversation-heading" className="order-2 overflow-hidden lg:order-1">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
            <CardTitle id="conversation-heading" as="h3" className="text-base font-semibold">
              Conversation
            </CardTitle>
          </div>
          <div className="px-5 py-5 sm:px-6">
            <Transcript messages={detail.messages} customer={customer} reason={reason} onChange={onMessage} />
          </div>
        </Card>

        <Card aria-labelledby="grade-heading" className="order-1 self-start lg:sticky lg:top-20 lg:order-2">
          <CardHeader>
            <CardTitle id="grade-heading" as="h3">
              Your grade
            </CardTitle>
            <CardDescription>Read the whole conversation. Were the agent&apos;s answers right?</CardDescription>
          </CardHeader>
          <form
            noValidate
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void save(true);
            }}
            className="flex flex-col gap-4 px-6 py-5"
          >
            {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Grade</legend>
              <div className="grid grid-cols-2 gap-2">
                {grades.map((g) => {
                  const chosen = grade === g.value;
                  const Icon = g.value === "right" ? CheckIcon : XIcon;
                  return (
                    <label
                      key={g.value}
                      className={cn(
                        "flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-base font-medium transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-rust",
                        chosen
                          ? g.value === "wrong"
                            ? "border-rust bg-rust text-on-rust"
                            : "border-ink bg-ink text-paper"
                          : "border-line-strong bg-surface text-ink hover:bg-surface-2",
                      )}
                    >
                      <input
                        type="radio"
                        name="grade"
                        value={g.value}
                        checked={chosen}
                        onChange={() => setGrade(g.value)}
                        className="sr-only"
                      />
                      <Icon aria-hidden="true" className="size-4" weight="bold" />
                      {g.label}
                    </label>
                  );
                })}
              </div>
              {form.fieldError("grade") ? <p className="text-sm text-rust">{form.fieldError("grade")}</p> : null}
              <p className="text-sm text-ink-muted">{grades.find((g) => g.value === grade)?.hint ?? "Choose one."}</p>
            </fieldset>
            <Field label="Note" hint="Optional. With a wrong grade, it becomes the reason on the answer.">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Refunds take 14 days, not 30."
              />
            </Field>
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
              <Button type="submit" loading={form.pending}>
                {detail.next_id ? "Save and next" : "Save and finish"}
              </Button>
              <Button variant="secondary" disabled={form.pending} onClick={() => void save(false)}>
                Save
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
