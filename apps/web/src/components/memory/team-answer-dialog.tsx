"use client";

import type { GapGroup, TeamAnswer, TeamAnswerInput } from "@docent/api-client";
import { useState, type FormEvent } from "react";
import { AudienceField, readAudience } from "@/components/knowledge/audience-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatCount, plural } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";

const QUESTION_MAX = 300;
const ANSWER_MAX = 4000;
const COUNT_FROM = 3600;

/**
 * Write, edit, or answer a knowledge gap with a team answer. Mount it with a new
 * key per opening for fresh state. From a gap, the question is filled in and
 * saving closes every question in that group.
 */
export function TeamAnswerDialog({
  open,
  editing,
  gap,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: TeamAnswer | null;
  gap: GapGroup | null;
  onClose: () => void;
  onSaved: (answer: TeamAnswer) => void;
}) {
  const form = useApiForm();
  const [question, setQuestion] = useState(editing?.question ?? gap?.question.slice(0, QUESTION_MAX) ?? "");
  const [answer, setAnswer] = useState(editing?.answer ?? "");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = form.check({
      question: question.trim().length < 3 && "Write the question as a customer would ask it.",
      answer: !answer.trim() && "Write the answer the agent should give.",
    });
    if (!ok) return;
    const body: TeamAnswerInput = {
      question: question.trim(),
      answer: answer.trim(),
      audience: readAudience(new FormData(event.currentTarget)),
      gap_ids: gap?.ids ?? [],
    };
    await form.run(
      () =>
        request(
          editing
            ? api.PUT("/v1/memory/answers/{answer_id}", { params: { path: { answer_id: editing.id } }, body })
            : api.POST("/v1/memory/answers", { body }),
        ),
      onSaved,
    );
  }

  const title = editing ? "Edit team answer" : gap ? "Answer this question" : "Add a team answer";
  const description = gap
    ? `The agent learns the answer, and the ${gap.count === 1 ? "question closes" : `${gap.count} matching questions close`}.`
    : "The agent searches it like your help articles and cites it when it answers.";

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={title} description={description}>
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field
            label="Question"
            error={form.fieldError("question")}
            hint="Write it the way a customer would ask. The agent also finds it for other wordings."
          >
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={QUESTION_MAX}
              autoComplete="off"
              placeholder="Can I export my notes to a spreadsheet?"
              autoFocus={!gap}
            />
          </Field>
          {gap && gap.examples.length > 0 ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-line bg-paper px-3.5 py-3">
              <p className="text-sm font-medium text-ink">Also asked as</p>
              <ul className="flex flex-col gap-1 text-sm text-ink-muted">
                {gap.examples.map((example) => (
                  <li key={example} dir="auto" className="break-words">
                    {example}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Field
            label="Answer"
            error={form.fieldError("answer")}
            hint={
              <span className="flex justify-between gap-3">
                <span>Plain text. Keep it to what is true for every customer who asks.</span>
                {answer.length >= COUNT_FROM ? (
                  <span className={cn("shrink-0 tabular-nums", answer.length >= ANSWER_MAX && "text-rust")}>
                    {formatCount(answer.length)} of {formatCount(ANSWER_MAX)}
                  </span>
                ) : null}
              </span>
            }
          >
            <Textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              maxLength={ANSWER_MAX}
              rows={6}
              placeholder="Yes. Open Settings, then Export, and choose CSV."
              autoFocus={Boolean(gap)}
            />
          </Field>
          <AudienceField defaultValue={editing?.audience} error={form.fieldError("audience")} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            {editing ? "Save changes" : gap ? `Save and close ${plural(gap.count, "question")}` : "Add answer"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
