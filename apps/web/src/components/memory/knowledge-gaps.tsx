"use client";

import type { GapGroup } from "@docent/api-client";
import { ChatTeardropTextIcon, SealQuestionIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { api, request } from "@/lib/api/browser";
import { formatCount, formatRelative, plural } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";
import { PanelEmpty, PanelIntro } from "./panel";

/** Product questions the agent could not answer, grouped by meaning, largest group first. */
export function KnowledgeGaps({
  gaps,
  canManage,
  onAnswer,
  onDismissed,
}: {
  gaps: GapGroup[];
  canManage: boolean;
  onAnswer: (gap: GapGroup) => void;
  onDismissed: (gap: GapGroup) => void;
}) {
  const now = useNow();
  const [dismissing, setDismissing] = useState<GapGroup | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PanelIntro>
        Product questions customers asked that nothing in your sources answered, so the agent handed them to your team.
        Questions that mean the same thing are grouped. Answer one to teach the agent, or dismiss it if it is not worth
        an answer.{canManage ? null : " Owners and admins answer and dismiss them."}
      </PanelIntro>

      {gaps.length === 0 ? (
        <PanelEmpty
          icon={<SealQuestionIcon aria-hidden="true" className="size-6" weight="light" />}
          title="No knowledge gaps"
        >
          When a customer asks a product question your sources do not cover, the agent hands it to your team and lists it
          here. Answer it once and the agent knows it the next time.
        </PanelEmpty>
      ) : (
        <Card aria-label="Knowledge gaps">
          <ul>
            {gaps.map((gap) => (
              <li
                key={gap.ids[0]}
                className="flex flex-col gap-3 border-b border-line px-6 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p dir="auto" className="font-medium break-words text-ink">
                    {gap.question}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                    <span className="inline-flex items-center gap-1.5 font-medium text-rust tabular-nums">
                      <SealQuestionIcon aria-hidden="true" className="size-3.5" weight="bold" />
                      Asked {formatCount(gap.count)} {plural(gap.count, "time")}
                    </span>
                    <span>Last asked {formatRelative(gap.last_asked_at, now)}</span>
                  </p>
                  {gap.examples.length > 0 ? (
                    <div className="mt-1 flex flex-col gap-1 text-sm">
                      <p className="text-ink-muted">Also asked as</p>
                      <ul className="flex flex-col gap-1 border-l border-line-strong pl-3 text-ink">
                        {gap.examples.map((example) => (
                          <li key={example} dir="auto" className="break-words">
                            {example}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onAnswer(gap)}
                      icon={<ChatTeardropTextIcon aria-hidden="true" className="size-4" />}
                    >
                      Answer this
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDismissing(gap)}>
                      Dismiss
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canManage ? (
        <DismissDialog
          target={dismissing}
          onClose={() => setDismissing(null)}
          onDismissed={(gap) => {
            setDismissing(null);
            onDismissed(gap);
          }}
        />
      ) : null}
    </div>
  );
}

function DismissDialog({
  target,
  onClose,
  onDismissed,
}: {
  target: GapGroup | null;
  onClose: () => void;
  onDismissed: (gap: GapGroup) => void;
}) {
  const form = useApiForm();
  // Keep the last target so the text does not vanish while the dialog fades out.
  const [last, setLast] = useState(target);
  if (target && target !== last) setLast(target);
  const shown = target ?? last;
  const many = (shown?.count ?? 1) > 1;

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={many ? `Dismiss these ${shown?.count} questions?` : "Dismiss this question?"}
      description="The agent learns nothing from a dismissal. If customers ask again, the question comes back here."
    >
      <DialogBody className="flex flex-col gap-3 pt-4 pb-2">
        {shown ? (
          <p dir="auto" className="rounded-md border border-line bg-paper px-3.5 py-3 text-base font-medium break-words text-ink">
            {shown.question}
          </p>
        ) : null}
        {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
      </DialogBody>
      <div className="h-3" />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={form.pending}
          onClick={() => {
            if (!shown) return;
            void form.run(
              () => request(api.POST("/v1/memory/gaps/dismiss", { body: { ids: shown.ids } })),
              () => onDismissed(shown),
            );
          }}
        >
          Dismiss
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
