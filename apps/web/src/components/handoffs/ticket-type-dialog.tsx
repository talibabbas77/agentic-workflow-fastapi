"use client";

import type { TicketType, TicketTypeInput } from "@docent/api-client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ChipField } from "@/components/ui/chip-field";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, request } from "@/lib/api/browser";
import { useApiForm } from "@/lib/use-api-form";
import { fieldProblems, FieldsEditor, toFieldRows, type FieldRow, type RowErrors } from "./fields-editor";

export const priorities = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const satisfies readonly { value: TicketType["priority"]; label: string }[];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create a ticket type, or edit `editing`. Mount it with a new key per opening for fresh state. */
export function TicketTypeDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: TicketType | null;
  onClose: () => void;
  onSaved: (ticketType: TicketType) => void;
}) {
  const form = useApiForm();
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [priority, setPriority] = useState<TicketType["priority"]>(editing?.priority ?? "normal");
  const [active, setActive] = useState(editing?.active ?? true);
  const [rows, setRows] = useState<FieldRow[]>(() => toFieldRows(editing?.fields ?? []));
  const [notify, setNotify] = useState(editing?.notify_emails ?? []);
  // Row problems show after the first save attempt, then update as people fix them.
  const [checked, setChecked] = useState(false);

  const rowErrors = new Map<number, RowErrors>(checked ? fieldProblems(rows) : []);
  // The API names a field's problem by its position, such as fields.2.key.
  rows.forEach((row, index) => {
    const server = (part: string) => form.error?.fields?.[`fields.${index}.${part}`];
    const label = server("label");
    const key = server("key");
    const options = server("options");
    if (label || key || options) rowErrors.set(row.id, { label, key, options, ...rowErrors.get(row.id) });
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecked(true);
    const ok = form.check({
      name: !name.trim() && "Name the ticket type.",
      description: !description.trim() && "Say what belongs in this type.",
      fields: fieldProblems(rows).size > 0 && "Fix the details marked below.",
    });
    if (!ok) return;
    const body: TicketTypeInput = {
      name: name.trim(),
      description: description.trim(),
      priority,
      active,
      notify_emails: notify,
      fields: rows.map((row) => ({
        key: row.key,
        label: row.label.trim(),
        type: row.type,
        required: row.required,
        options: row.type === "select" ? row.options : [],
      })),
    };
    await form.run(
      () =>
        request(
          editing
            ? api.PUT("/v1/ticket-types/{ticket_type_id}", { params: { path: { ticket_type_id: editing.id } }, body })
            : api.POST("/v1/ticket-types", { body }),
        ),
      onSaved,
    );
  }

  const nameTaken = form.error?.code === "name_taken";
  // Problems inside a detail show on the detail itself, not again at the top.
  const fieldsError = form.fieldError("fields");
  const topError = nameTaken ? null : form.formError;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${editing.name}` : "Add a ticket type"}
      description="A kind of request your team handles. The agent sorts each handoff into the type that fits."
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-6">
          {topError ? <FormAlert>{topError}</FormAlert> : null}
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="Name" error={nameTaken ? form.error?.message : form.fieldError("name")}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                autoComplete="off"
                placeholder="Refund request"
                autoFocus
              />
            </Field>
            <Field label="Priority" error={form.fieldError("priority")}>
              <Select value={priority} onChange={(event) => setPriority(event.target.value as TicketType["priority"])}>
                {priorities.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label="What belongs here"
            error={form.fieldError("description")}
            hint="The agent reads this to choose the type, so name the requests it covers."
          >
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Customers asking for money back on an order or a subscription."
            />
          </Field>
          <div className="flex flex-col gap-3">
            <FieldsEditor rows={rows} onChange={setRows} errors={rowErrors} />
            {fieldsError && !rows.some((row) => rowErrors.has(row.id)) ? (
              <FormAlert>{fieldsError}</FormAlert>
            ) : null}
          </div>
          <ChipField
            label="Who to email"
            values={notify}
            onChange={setNotify}
            max={10}
            maxLength={254}
            validate={(email) => (EMAIL.test(email) ? null : `${email} is not an email address.`)}
            placeholder="name@company.com"
            error={form.fieldError("notify_emails")}
            hint="Docent emails these people about each handoff of this type. Up to 10."
          />
          <Switch
            checked={active}
            onChange={setActive}
            label="Active"
            hint="The agent only sorts handoffs into active types."
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            {editing ? "Save changes" : "Add ticket type"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
