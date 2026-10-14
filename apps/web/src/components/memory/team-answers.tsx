"use client";

import type { Source, TeamAnswer } from "@docent/api-client";
import { ChatTeardropTextIcon, DotsThreeIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AudienceBadge, StatusLabel } from "@/components/knowledge/source-meta";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { api, request } from "@/lib/api/browser";
import { formatCount, formatRelative } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";
import { PanelEmpty, PanelIntro } from "./panel";

/** Team answers: question and answer pairs the agent searches and cites like help articles. */
export function TeamAnswers({
  answers,
  canManage,
  onAdd,
  onEdit,
  onDeleted,
}: {
  answers: TeamAnswer[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (answer: TeamAnswer) => void;
  onDeleted: (answer: TeamAnswer) => void;
}) {
  const now = useNow();
  const [deleting, setDeleting] = useState<TeamAnswer | null>(null);

  const addButton = canManage ? (
    <Button onClick={onAdd} icon={<PlusIcon aria-hidden="true" className="size-4" />}>
      Add answer
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <PanelIntro action={answers.length > 0 ? addButton : null}>
        Short answers your team writes for questions your sources do not cover. The agent searches them like your help
        articles and cites them the same way.
      </PanelIntro>

      {answers.length === 0 ? (
        <PanelEmpty
          icon={<ChatTeardropTextIcon aria-hidden="true" className="size-6" weight="light" />}
          title="No team answers yet"
          action={addButton ?? <p className="text-base text-ink-muted">Owners and admins write team answers.</p>}
        >
          Write the answer to a question customers ask, or answer a knowledge gap. The agent can cite it within a
          minute.
        </PanelEmpty>
      ) : (
        <Card aria-label="Team answers">
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-base max-md:block">
              <thead className="max-md:hidden">
                <tr className="border-b border-line text-sm text-ink-muted">
                  <th scope="col" className="px-6 py-2.5 font-medium">
                    Question and answer
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Audience
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                    Cited, 30 days
                  </th>
                  {canManage ? (
                    <th scope="col" className="w-16 px-6 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="max-md:block">
                {answers.map((answer) => (
                  <tr
                    key={answer.id}
                    className="border-b border-line align-top transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60 max-md:relative max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-4 max-md:gap-y-2 max-md:px-6 max-md:py-4"
                  >
                    <td className="px-6 py-3.5 max-md:w-full max-md:p-0 max-md:pr-10">
                      <div className="flex min-w-0 flex-col gap-1">
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => onEdit(answer)}
                            className="self-start rounded-sm text-left font-medium break-words text-ink underline-offset-[3px] hover:underline"
                          >
                            {answer.question}
                          </button>
                        ) : (
                          <span className="font-medium break-words text-ink">{answer.question}</span>
                        )}
                        <span dir="auto" className="line-clamp-2 max-w-2xl text-sm break-words text-ink-muted">
                          {answer.answer}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {answer.created_by_name ? `${answer.created_by_name}, ` : ""}
                          updated {formatRelative(answer.updated_at, now)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 max-md:p-0">
                      <AudienceBadge audience={answer.audience} />
                    </td>
                    <td className="px-3 py-3.5 max-md:p-0">
                      <StatusLabel status={answer.status as Source["status"]} />
                    </td>
                    <td className="px-3 py-3.5 text-right text-ink-muted tabular-nums max-md:p-0 max-md:text-sm">
                      {formatCount(answer.citations_30d)}
                      <span className="md:hidden"> cited in 30 days</span>
                    </td>
                    {canManage ? (
                      <td className="px-6 py-2.5 text-right max-md:absolute max-md:top-3 max-md:right-4 max-md:p-0">
                        <PopoverMenu
                          label={`Actions for ${answer.question}`}
                          align="end"
                          className="w-44"
                          trigger={(props) => (
                            <Button variant="ghost" size="icon" {...props} aria-label={`Actions for ${answer.question}`}>
                              <DotsThreeIcon aria-hidden="true" className="size-4.5" weight="bold" />
                            </Button>
                          )}
                        >
                          {(close) => (
                            <>
                              <MenuItem
                                icon={<PencilSimpleIcon aria-hidden="true" className="size-4 text-ink-muted" />}
                                onClick={() => {
                                  close();
                                  onEdit(answer);
                                }}
                              >
                                Edit
                              </MenuItem>
                              <MenuSeparator />
                              <MenuItem
                                className="text-rust"
                                icon={<TrashIcon aria-hidden="true" className="size-4" />}
                                onClick={() => {
                                  close();
                                  setDeleting(answer);
                                }}
                              >
                                Delete
                              </MenuItem>
                            </>
                          )}
                        </PopoverMenu>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canManage ? (
        <DeleteAnswerDialog
          target={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(answer) => {
            setDeleting(null);
            onDeleted(answer);
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteAnswerDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: TeamAnswer | null;
  onClose: () => void;
  onDeleted: (answer: TeamAnswer) => void;
}) {
  const form = useApiForm();
  // Keep the last target so the text does not vanish while the dialog fades out.
  const [last, setLast] = useState(target);
  if (target && target !== last) setLast(target);
  const shown = target ?? last;

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title="Delete this team answer?"
      description="The agent stops using it within a minute. Questions it already closed stay closed."
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
              () =>
                request(api.DELETE("/v1/memory/answers/{answer_id}", { params: { path: { answer_id: shown.id } } })),
              () => onDeleted(shown),
            );
          }}
        >
          Delete answer
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
