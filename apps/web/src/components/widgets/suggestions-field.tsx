"use client";

import { PlusIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export const MAX_SUGGESTIONS = 4;
export const SUGGESTION_MAX_LENGTH = 100;

export type SuggestionRow = { id: number; value: string };

export function toSuggestionRows(suggestions: string[]): SuggestionRow[] {
  return suggestions.map((value, index) => ({ id: index + 1, value }));
}

/** The typed questions with spaces tidied, without blank rows. The API checks them again. */
export function readSuggestions(rows: SuggestionRow[]) {
  return rows.map((row) => row.value.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** A sentence when two questions are the same (ignoring case), or null. */
export function duplicateSuggestion(rows: SuggestionRow[]) {
  const seen = new Set<string>();
  for (const value of readSuggestions(rows)) {
    const key = value.toLowerCase();
    if (seen.has(key)) return `"${value}" is in the list twice. Each question must be different.`;
    seen.add(key);
  }
  return null;
}

/** Questions the widget offers under the greeting, one per row, four at most. */
export function SuggestionsField({
  rows,
  onChange,
  error,
  readOnly,
}: {
  rows: SuggestionRow[];
  onChange: (rows: SuggestionRow[]) => void;
  error?: string;
  readOnly?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hintId].filter(Boolean).join(" ");
  // The row to focus once it renders, after "Add question".
  const focusRow = useRef<number | null>(null);

  function add() {
    const next = Math.max(0, ...rows.map((row) => row.id)) + 1;
    focusRow.current = next;
    onChange([...rows, { id: next, value: "" }]);
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={describedBy}>
      <legend className="mb-1.5 text-sm font-medium text-ink">Suggested questions</legend>
      {rows.length === 0 && readOnly ? <p className="text-base text-ink-muted">None</p> : null}
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={row.id} className="flex items-center gap-2">
              <Input
                ref={(element) => {
                  if (element && focusRow.current === row.id) {
                    focusRow.current = null;
                    element.focus();
                  }
                }}
                aria-label={`Question ${index + 1}`}
                aria-invalid={error ? true : undefined}
                value={row.value}
                onChange={(event) =>
                  onChange(rows.map((other) => (other.id === row.id ? { ...other, value: event.target.value } : other)))
                }
                readOnly={readOnly}
                maxLength={SUGGESTION_MAX_LENGTH}
                autoComplete="off"
                placeholder="How do I change my plan?"
              />
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={`Remove question ${index + 1}`}
                  onClick={() => onChange(rows.filter((other) => other.id !== row.id))}
                >
                  <XIcon aria-hidden="true" className="size-4.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {readOnly || rows.length >= MAX_SUGGESTIONS ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start"
          icon={<PlusIcon aria-hidden="true" className="size-4" />}
          onClick={add}
        >
          Add question
        </Button>
      )}
      <p id={hintId} className="text-sm text-ink-muted">
        Shown under the greeting until the visitor writes. A click sends the question as their message, so pick ones
        your sources answer. Up to {MAX_SUGGESTIONS}, {SUGGESTION_MAX_LENGTH} characters each.
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
