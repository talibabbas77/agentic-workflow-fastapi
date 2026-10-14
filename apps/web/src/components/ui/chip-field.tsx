"use client";

import { XIcon } from "@phosphor-icons/react";
import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Field, useField } from "./field";

type ChipFieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  /** An error from the server. A problem with what is being typed shows instead while it lasts. */
  error?: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Return a sentence when a value cannot be added. Duplicates and the limit are checked already. */
  validate?: (value: string) => string | null;
  max: number;
  maxLength?: number;
  placeholder?: string;
  readOnly?: boolean;
  mono?: boolean;
};

/**
 * A list of short values typed one at a time. Enter or a comma adds what was
 * typed, Backspace in an empty box removes the last one, and pasting a list
 * adds each item. Leaving the box adds what was typed, so nothing is lost on save.
 */
export function ChipField({ label, hint, error, readOnly, ...rest }: ChipFieldProps) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Field label={label} hint={hint} error={problem ?? error}>
      {readOnly ? (
        <ReadOnlyChips values={rest.values} mono={rest.mono} />
      ) : (
        <ChipInput {...rest} onProblem={setProblem} />
      )}
    </Field>
  );
}

const chipClasses =
  "inline-flex h-6 max-w-full items-center gap-0.5 rounded-sm border border-line bg-surface-2 text-sm text-ink";

function ReadOnlyChips({ values, mono }: { values: string[]; mono?: boolean }) {
  const field = useField();
  if (values.length === 0) {
    return (
      <p id={field?.id} className="text-base text-ink-muted">
        None
      </p>
    );
  }
  return (
    <ul id={field?.id} aria-describedby={field?.describedBy} className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <li key={value} className={cn(chipClasses, "px-2", mono && "font-mono")}>
          <span className="truncate">{value}</span>
        </li>
      ))}
    </ul>
  );
}

function ChipInput({
  values,
  onChange,
  validate,
  max,
  maxLength,
  placeholder,
  mono,
  onProblem,
}: Omit<ChipFieldProps, "label" | "hint" | "error" | "readOnly"> & { onProblem: (problem: string | null) => void }) {
  const field = useField();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const full = values.length >= max;

  /** Add each item; keep the first one that cannot be added in the box with its reason. */
  function commit(items: string[]) {
    const next = [...values];
    for (const raw of items) {
      const value = raw.trim();
      if (!value) continue;
      const problem =
        next.length >= max
          ? `${max} at most.`
          : next.some((v) => v.toLowerCase() === value.toLowerCase())
            ? `${value} is already in the list.`
            : (validate?.(value) ?? null);
      if (problem) {
        onChange(next);
        setDraft(value);
        onProblem(problem);
        return;
      }
      next.push(value);
    }
    onChange(next);
    setDraft("");
    onProblem(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit([draft]);
    } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
      onProblem(null);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!/[,\n]/.test(text)) return;
    event.preventDefault();
    commit(`${draft}${text}`.split(/[,\n]/));
  }

  return (
    <div
      onClick={() => input.current?.focus()}
      className={cn(
        "flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5 transition-colors duration-150",
        "has-[input:focus]:outline-2 has-[input:focus]:outline-offset-2 has-[input:focus]:outline-rust",
        field?.invalid ? "border-rust" : "border-line-strong hover:border-ink-subtle",
      )}
    >
      {values.map((value) => (
        <span key={value} className={cn(chipClasses, "pl-2", mono && "font-mono")}>
          <span className="truncate">{value}</span>
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={(event) => {
              event.stopPropagation();
              onChange(values.filter((v) => v !== value));
              onProblem(null);
              input.current?.focus();
            }}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-line hover:text-ink"
          >
            <XIcon aria-hidden="true" className="size-3" weight="bold" />
          </button>
        </span>
      ))}
      <input
        ref={input}
        id={field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onProblem(null);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => {
          if (draft.trim()) commit([draft]);
        }}
        disabled={full}
        maxLength={maxLength}
        placeholder={full ? `${max} at most` : values.length === 0 ? placeholder : undefined}
        autoComplete="off"
        className={cn(
          "h-6 min-w-32 flex-1 bg-transparent px-1 text-md text-ink outline-none placeholder:text-ink-subtle disabled:bg-transparent sm:text-base",
          mono && "font-mono",
        )}
      />
    </div>
  );
}
