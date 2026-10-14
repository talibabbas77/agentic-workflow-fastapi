"use client";

import type { EvalSet } from "@docent/api-client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { api, request } from "@/lib/api/browser";
import { useApiForm } from "@/lib/use-api-form";

/** Create a set, or rename one. Mount it with a new key per opening for fresh state. */
export function SetDialog({
  open,
  onClose,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  existing?: EvalSet;
  onSaved: (set: EvalSet) => void;
}) {
  const form = useApiForm();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.check({ name: !name.trim() && "Give the set a name." })) return;
    const body = { name: name.trim(), description: description.trim() };
    await form.run(
      () =>
        request(
          existing
            ? api.PATCH("/v1/evals/sets/{set_id}", { params: { path: { set_id: existing.id } }, body })
            : api.POST("/v1/evals/sets", { body }),
        ),
      onSaved,
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? "Edit set" : "New eval set"}
      description="A set groups test questions you run together, such as one per product area."
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-4">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field label="Name" error={form.fieldError("name")}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Billing questions"
              autoFocus
            />
          </Field>
          <Field label="Description" hint="Optional." error={form.fieldError("description")}>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Refunds, invoices, and plan changes."
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            {existing ? "Save" : "Create set"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
