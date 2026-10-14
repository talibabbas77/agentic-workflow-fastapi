"use client";

import type { TicketType } from "@docent/api-client";
import { CheckIcon, DotsThreeIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { TicketTypesIllustration } from "@/components/illustrations/illustrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { plural } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { priorities, TicketTypeDialog } from "./ticket-type-dialog";

const priorityTone = { low: "outline", normal: "outline", high: "neutral", urgent: "accent" } as const;
const priorityLabel = Object.fromEntries(priorities.map((p) => [p.value, p.label])) as Record<
  TicketType["priority"],
  string
>;

const byName = (a: TicketType, b: TicketType) => a.name.localeCompare(b.name);

/** Ticket types: what a handoff collects, how urgent it is, and who hears about it. */
export function TicketTypesManager({ initial, canManage }: { initial: TicketType[]; canManage: boolean }) {
  const toast = useToast();
  const [types, setTypes] = useState(initial);
  const [editing, setEditing] = useState<TicketType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // A new key per opening gives the dialog fresh state each time.
  const [dialogKey, setDialogKey] = useState(0);
  const [deleting, setDeleting] = useState<TicketType | null>(null);

  function openDialog(ticketType: TicketType | null) {
    setEditing(ticketType);
    setDialogKey((n) => n + 1);
    setDialogOpen(true);
  }

  const addButton = canManage ? (
    <Button onClick={() => openDialog(null)} icon={<PlusIcon aria-hidden="true" className="size-4" />}>
      Add ticket type
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Handoffs"
        description="When the agent passes a conversation to your team, it sorts it into one of these types and fills in what the type asks for."
        actions={types.length > 0 ? addButton : null}
      />

      {types.length === 0 ? (
        <EmptyState
          illustration={<TicketTypesIllustration />}
          title="No ticket types yet"
          action={addButton ?? <p className="text-base text-ink-muted">Owners and admins add ticket types.</p>}
        >
          <p>
            A ticket type is a kind of request your team handles, such as a refund or a bug report. Docent sorts each
            handoff into the type that fits, collects the details it asks for, and lets the right people know.
          </p>
        </EmptyState>
      ) : (
        <Card aria-label="Ticket types">
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-base max-md:block">
              <thead className="max-md:hidden">
                <tr className="border-b border-line text-sm text-ink-muted">
                  <th scope="col" className="px-6 py-2.5 font-medium">
                    Ticket type
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Collects
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Emails
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Priority
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Status
                  </th>
                  {canManage ? (
                    <th scope="col" className="w-16 px-6 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="max-md:block">
                {types.map((type) => (
                  <tr
                    key={type.id}
                    className="border-b border-line align-top transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60 max-md:relative max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-4 max-md:gap-y-2 max-md:px-6 max-md:py-4"
                  >
                    <td className="px-6 py-3.5 max-md:w-full max-md:p-0 max-md:pr-10">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => openDialog(type)}
                            className="self-start rounded-sm text-left font-medium text-ink underline-offset-[3px] hover:underline"
                          >
                            {type.name}
                          </button>
                        ) : (
                          <span className="font-medium text-ink">{type.name}</span>
                        )}
                        <span className="line-clamp-2 max-w-md text-sm text-ink-muted">{type.description}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-ink-muted tabular-nums max-md:p-0 max-md:text-sm">
                      {type.fields.length === 0
                        ? "No details"
                        : `${type.fields.length} ${plural(type.fields.length, "detail")}`}
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-ink-muted tabular-nums max-md:p-0 max-md:text-sm">
                      {type.notify_emails.length === 0
                        ? "No one"
                        : `${type.notify_emails.length} ${plural(type.notify_emails.length, "person", "people")}`}
                    </td>
                    <td className="px-3 py-3.5 max-md:p-0">
                      <Badge tone={priorityTone[type.priority]}>{priorityLabel[type.priority]}</Badge>
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap max-md:p-0">
                      {type.active ? (
                        <span className="inline-flex items-center gap-1.5 text-ink">
                          <CheckIcon aria-hidden="true" className="size-3.5" weight="bold" />
                          Active
                        </span>
                      ) : (
                        <span className="text-ink-muted">Off</span>
                      )}
                    </td>
                    {canManage ? (
                      <td className="px-6 py-2.5 text-right max-md:absolute max-md:top-3 max-md:right-4 max-md:p-0">
                        <PopoverMenu
                          label={`Actions for ${type.name}`}
                          align="end"
                          className="w-44"
                          trigger={(props) => (
                            <Button variant="ghost" size="icon" {...props} aria-label={`Actions for ${type.name}`}>
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
                                  openDialog(type);
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
                                  setDeleting(type);
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
        <>
          <TicketTypeDialog
            key={dialogKey}
            open={dialogOpen}
            editing={editing}
            onClose={() => setDialogOpen(false)}
            onSaved={(saved) => {
              setDialogOpen(false);
              setTypes((all) => [...all.filter((t) => t.id !== saved.id), saved].sort(byName));
              toast({
                tone: "success",
                title: editing ? "Ticket type saved" : "Ticket type added",
                description: saved.name,
              });
            }}
          />
          <DeleteDialog
            target={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={(removed) => {
              setDeleting(null);
              setTypes((all) => all.filter((t) => t.id !== removed.id));
              toast({ tone: "success", title: "Ticket type deleted", description: removed.name });
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function DeleteDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: TicketType | null;
  onClose: () => void;
  onDeleted: (ticketType: TicketType) => void;
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
      title={`Delete ${shown?.name ?? "ticket type"}?`}
      description="The agent stops using it right away. Earlier handoffs keep their details, without a type."
    >
      {form.formError ? (
        <DialogBody className="pt-4 pb-2">
          <FormAlert>{form.formError}</FormAlert>
        </DialogBody>
      ) : (
        <div className="h-5" />
      )}
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
                request(
                  api.DELETE("/v1/ticket-types/{ticket_type_id}", { params: { path: { ticket_type_id: shown.id } } }),
                ),
              () => onDeleted(shown),
            );
          }}
        >
          Delete ticket type
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
