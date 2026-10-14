"use client";

import { PlusIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export const MAX_ORIGINS = 20;

export type OriginRow = { id: number; value: string };

export function toOriginRows(origins: string[]): OriginRow[] {
  const rows = origins.map((value, index) => ({ id: index + 1, value }));
  return rows.length > 0 ? rows : [{ id: 1, value: "" }];
}

/** The typed origins, without blank rows. The API checks and normalizes them. */
export function readOrigins(rows: OriginRow[]) {
  return rows.map((row) => row.value.trim()).filter(Boolean);
}

/** The sites a widget may appear on, one origin per row. */
export function OriginsField({
  rows,
  onChange,
  error,
  readOnly,
}: {
  rows: OriginRow[];
  onChange: (rows: OriginRow[]) => void;
  error?: string;
  readOnly?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hintId].filter(Boolean).join(" ");

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={describedBy}>
      <legend className="mb-1.5 text-sm font-medium text-ink">Allowed sites</legend>
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={row.id} className="flex items-center gap-2">
            <Input
              aria-label={`Site ${index + 1}`}
              aria-invalid={error ? true : undefined}
              value={row.value}
              onChange={(event) =>
                onChange(rows.map((other) => (other.id === row.id ? { ...other, value: event.target.value } : other)))
              }
              readOnly={readOnly}
              type="url"
              inputMode="url"
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              placeholder="https://app.example.com"
            />
            {readOnly ? null : (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={`Remove site ${index + 1}`}
                disabled={rows.length === 1 && !row.value}
                onClick={() =>
                  onChange(rows.length === 1 ? [{ id: row.id, value: "" }] : rows.filter((other) => other.id !== row.id))
                }
              >
                <XIcon aria-hidden="true" className="size-4.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {readOnly || rows.length >= MAX_ORIGINS ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start"
          icon={<PlusIcon aria-hidden="true" className="size-4" />}
          onClick={() => onChange([...rows, { id: Math.max(0, ...rows.map((row) => row.id)) + 1, value: "" }])}
        >
          Add site
        </Button>
      )}
      <p id={hintId} className="text-sm text-ink-muted">
        The exact origin of each page that shows the widget: scheme, host, and port, with no path. Browsers refuse to
        show it anywhere else.
      </p>
      <div id={errorId} aria-live="polite">
        {error ? (
          <p className="flex items-start gap-1.5 text-sm text-rust">
            <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
