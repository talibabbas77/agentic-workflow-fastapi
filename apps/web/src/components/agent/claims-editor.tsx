"use client";

import { PlusIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export type ClaimRow = { id: number; key: string; value: string };

export const CLAIM_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_CLAIMS = 20;

/** What is wrong with each row, by row id. Rows with neither a name nor a value are skipped. */
export function claimProblems(rows: ClaimRow[]) {
  const problems = new Map<number, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key && !row.value.trim()) continue;
    const problem = !key
      ? "Give this claim a name."
      : !CLAIM_KEY.test(key)
        ? "Use lowercase letters, digits, and underscores, starting with a letter."
        : seen.has(key)
          ? "Each claim name can appear once."
          : null;
    if (problem) problems.set(row.id, problem);
    seen.add(key);
  }
  return problems;
}

export function claimsObject(rows: ClaimRow[]) {
  return Object.fromEntries(rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value.trim()]));
}

/**
 * Stand-in for the custom claims in a customer's signed token, so staff can see
 * how the agent uses them. Locked once the conversation starts.
 */
export function ClaimsEditor({
  rows,
  onChange,
  locked,
}: {
  rows: ClaimRow[];
  onChange: (rows: ClaimRow[]) => void;
  locked: boolean;
}) {
  const id = useId();
  const problems = claimProblems(rows);
  const update = (rowId: number, change: Partial<ClaimRow>) =>
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...change } : row)));

  return (
    <fieldset disabled={locked} className="flex min-w-0 flex-col gap-2.5" aria-describedby={`${id}-hint`}>
      <legend className="mb-1 text-sm font-medium text-ink">Customer details</legend>
      <p id={`${id}-hint`} className="text-sm text-ink-muted">
        In production your server puts these in the customer&apos;s signed token, and only the ones you allow on the
        widget reach the agent.
      </p>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => {
            const problem = problems.get(row.id);
            const errorId = `${id}-${row.id}-error`;
            return (
              <li key={row.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Claim ${index + 1} name`}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? errorId : undefined}
                    value={row.key}
                    onChange={(event) => update(row.id, { key: event.target.value })}
                    placeholder="plan"
                    maxLength={40}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-[2] font-mono"
                  />
                  <Input
                    aria-label={`Claim ${index + 1} value`}
                    value={row.value}
                    onChange={(event) => update(row.id, { value: event.target.value })}
                    placeholder="Pro"
                    maxLength={200}
                    autoComplete="off"
                    className="min-w-0 flex-[3]"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove claim ${index + 1}`}
                    onClick={() => onChange(rows.filter((other) => other.id !== row.id))}
                    className="shrink-0"
                  >
                    <XIcon aria-hidden="true" className="size-4.5" />
                  </Button>
                </div>
                {problem ? (
                  <p id={errorId} className="flex items-start gap-1.5 text-sm text-rust">
                    <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
                    <span>{problem}</span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {rows.length < MAX_CLAIMS ? (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start"
          icon={<PlusIcon aria-hidden="true" className="size-4" />}
          onClick={() => onChange([...rows, { id: Math.max(0, ...rows.map((row) => row.id)) + 1, key: "", value: "" }])}
        >
          Add claim
        </Button>
      ) : null}
    </fieldset>
  );
}
