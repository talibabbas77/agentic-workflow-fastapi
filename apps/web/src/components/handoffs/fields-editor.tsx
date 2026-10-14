"use client";

import type { TicketField } from "@docent/api-client";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ChipField } from "@/components/ui/chip-field";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

export type FieldRow = Omit<TicketField, "options"> & {
  id: number;
  options: string[];
  /** Once someone types a key, or the field was saved, the key stops following the label. */
  keyEdited: boolean;
};

export type RowErrors = { label?: string; key?: string; options?: string };

export const MAX_FIELDS = 12;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

const types = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "number", label: "Number" },
  { value: "select", label: "Choice" },
] as const satisfies readonly { value: TicketField["type"]; label: string }[];

/** "Order number" becomes "order_number". */
function keyFrom(label: string) {
  const key = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (/^[a-z]/.test(key) ? key : key ? `field_${key}` : "").slice(0, 40).replace(/_+$/, "");
}

/** Problems per row id, for the checks the API would also make. */
export function fieldProblems(rows: FieldRow[]) {
  const problems = new Map<number, RowErrors>();
  const seen = new Set<string>();
  for (const row of rows) {
    const errors: RowErrors = {};
    if (!row.label.trim()) errors.label = "Add a label.";
    if (!FIELD_KEY.test(row.key)) errors.key = "Lowercase letters, digits, and underscores, starting with a letter.";
    else if (seen.has(row.key)) errors.key = "Another detail uses this key.";
    if (row.type === "select" && row.options.length === 0) errors.options = "Add at least one choice.";
    seen.add(row.key);
    if (Object.keys(errors).length > 0) problems.set(row.id, errors);
  }
  return problems;
}

export function toFieldRows(fields: TicketField[]): FieldRow[] {
  return fields.map((field, index) => ({ ...field, options: field.options ?? [], id: index + 1, keyEdited: true }));
}

/** Details a handoff of this type collects. Add, remove, and reorder; choices only for Choice. */
export function FieldsEditor({
  rows,
  onChange,
  errors,
}: {
  rows: FieldRow[];
  onChange: (rows: FieldRow[]) => void;
  /** Problems to show, by row id. Empty until the form was submitted once. */
  errors: Map<number, RowErrors>;
}) {
  const update = (id: number, change: Partial<FieldRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));

  const move = (index: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row!);
    onChange(next);
  };

  const add = () =>
    onChange([
      ...rows,
      {
        id: Math.max(0, ...rows.map((row) => row.id)) + 1,
        key: "",
        label: "",
        type: "text",
        required: false,
        options: [],
        keyEdited: false,
      },
    ]);

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-medium text-ink">Details to collect</legend>
      <p className="-mt-1 text-sm text-ink-muted">
        The agent fills these in from the conversation, so your team does not have to ask again.
      </p>
      {rows.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const rowErrors = errors.get(row.id) ?? {};
            const name = row.label.trim() || `Detail ${index + 1}`;
            return (
              <li key={row.id} className="flex flex-col gap-4 rounded-md border border-line bg-paper p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink-muted tabular-nums">Detail {index + 1}</p>
                  <div className="-my-1.5 -mr-2 flex items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${name} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${name} down`}
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${name}`}
                      onClick={() => onChange(rows.filter((other) => other.id !== row.id))}
                    >
                      <TrashIcon aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8.5rem]">
                  <Field label="Label" error={rowErrors.label}>
                    <Input
                      value={row.label}
                      maxLength={60}
                      autoComplete="off"
                      placeholder="Order number"
                      onChange={(event) =>
                        update(row.id, {
                          label: event.target.value,
                          ...(row.keyEdited ? {} : { key: keyFrom(event.target.value) }),
                        })
                      }
                    />
                  </Field>
                  <Field label="Key" error={rowErrors.key}>
                    <Input
                      value={row.key}
                      maxLength={40}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="order_number"
                      className="font-mono"
                      onChange={(event) => update(row.id, { key: event.target.value, keyEdited: true })}
                    />
                  </Field>
                  <Field label="Type">
                    <Select
                      value={row.type}
                      onChange={(event) => update(row.id, { type: event.target.value as TicketField["type"] })}
                    >
                      {types.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {row.type === "select" ? (
                  <ChipField
                    label="Choices"
                    values={row.options}
                    onChange={(options) => update(row.id, { options })}
                    max={20}
                    maxLength={60}
                    placeholder="Type a choice, then Enter"
                    error={rowErrors.options}
                  />
                ) : null}
                <label className="flex cursor-pointer items-center gap-2 self-start text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={row.required}
                    onChange={(event) => update(row.id, { required: event.target.checked })}
                    className="size-4 accent-rust"
                  />
                  Required
                </label>
              </li>
            );
          })}
        </ol>
      ) : null}
      {rows.length < MAX_FIELDS ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          icon={<PlusIcon aria-hidden="true" className="size-4" />}
          onClick={add}
        >
          Add detail
        </Button>
      ) : (
        <p className="text-sm text-ink-muted">{MAX_FIELDS} details at most.</p>
      )}
    </fieldset>
  );
}
