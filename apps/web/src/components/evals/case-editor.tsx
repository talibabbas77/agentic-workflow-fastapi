"use client";

import type {
  EvalCase,
  EvalCaseInput,
  EvalCasePrefill,
  EvalDocument,
  EvalExpected,
  EvalHistoryTurn,
} from "@docent/api-client";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { claimProblems, claimsObject, ClaimsEditor, type ClaimRow } from "@/components/agent/claims-editor";
import { Button } from "@/components/ui/button";
import { ChipField } from "@/components/ui/chip-field";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { api, request } from "@/lib/api/browser";
import { useApiForm } from "@/lib/use-api-form";
import { expectedOptions } from "./eval-meta";

const MAX_TURNS = 6;

type Turn = EvalHistoryTurn & { id: number };

export type CaseDraft = {
  question: string;
  expected: EvalExpected;
  signedIn: boolean;
  claims: ClaimRow[];
  history: Turn[];
  referenceAnswer: string;
  mustInclude: string[];
  mustNotInclude: string[];
  gold: string[];
  tags: string[];
};

const visitorModes = [
  { value: "anonymous", label: "Anonymous visitor" },
  { value: "identified", label: "Signed-in customer" },
] as const;

/** Form state from a saved case, a conversation, or nothing. */
export function caseDraft(source?: EvalCase | EvalCasePrefill | null): CaseDraft {
  const identity = source?.identity ?? null;
  return {
    question: source?.question ?? "",
    expected: source?.expected ?? "answer",
    signedIn: identity !== null,
    claims: Object.entries(identity ?? { plan: "Pro" }).map(([key, value], i) => ({ id: i + 1, key, value })),
    history: (source?.history ?? []).map((turn, i) => ({ ...turn, id: i + 1 })),
    referenceAnswer: source?.reference_answer ?? "",
    mustInclude: source && "must_include" in source ? source.must_include : [],
    mustNotInclude: source && "must_not_include" in source ? source.must_not_include : [],
    gold: source && "gold_documents" in source ? source.gold_documents.map((d) => d.id) : [],
    tags: source?.tags ?? [],
  };
}

/** Problems to show before sending, by field. */
export function caseProblems(draft: CaseDraft) {
  return {
    question: !draft.question.trim() && "Write the question the customer asks.",
    identity: draft.signedIn && claimProblems(draft.claims).size > 0 && "Fix the customer details marked below.",
    history: draft.history.some((t) => !t.content.trim()) && "Fill in or remove the empty turn.",
  };
}

/** The request body for this form. */
export function caseBody(draft: CaseDraft): EvalCaseInput {
  return {
    question: draft.question.trim(),
    expected: draft.expected,
    identity: draft.signedIn ? claimsObject(draft.claims) : null,
    history: draft.history.map(({ role, content }) => ({ role, content: content.trim() })),
    reference_answer: draft.referenceAnswer.trim(),
    must_include: draft.mustInclude,
    must_not_include: draft.mustNotInclude,
    gold_document_ids: draft.gold,
    tags: draft.tags,
  };
}

/** The fields of a test case. Used by the case dialog and by "Add to eval set". */
export function CaseFields({
  draft,
  onChange,
  documents,
  fieldError,
}: {
  draft: CaseDraft;
  onChange: (draft: CaseDraft) => void;
  documents: EvalDocument[];
  fieldError: (name: string) => string | undefined;
}) {
  const set = (change: Partial<CaseDraft>) => onChange({ ...draft, ...change });
  const titles = new Map(documents.map((d) => [d.id, d.title]));
  const available = documents.filter((d) => !draft.gold.includes(d.id));

  return (
    <div className="flex flex-col gap-6">
      <Field
        label="Question"
        error={fieldError("question")}
        hint="Word it the way a customer would. It goes through the real agent, with search and every check."
      >
        <Textarea
          value={draft.question}
          onChange={(event) => set({ question: event.target.value })}
          rows={2}
          maxLength={2000}
          placeholder="Can I get my money back on a yearly plan?"
          autoFocus
        />
      </Field>

      <SegmentedControl
        legend="What should happen"
        name="expected"
        value={draft.expected}
        options={expectedOptions}
        onChange={(expected) => set({ expected })}
        hint={
          draft.expected === "escalate"
            ? "Any answer counts as a wrong answer. Use this for requests only your team can handle."
            : draft.expected === "clarify"
              ? "The agent should ask what the customer means before answering."
              : "A cited answer the judge checks against the gold documents and the reference."
        }
      />

      <div className="flex flex-col gap-3">
        <SegmentedControl
          legend="Who is asking"
          name="visitor"
          value={draft.signedIn ? "identified" : "anonymous"}
          options={visitorModes}
          onChange={(mode) => set({ signedIn: mode === "identified" })}
          hint={
            draft.signedIn
              ? "The agent sees these details as verified, as from a signed token, and can search sign-in-only articles."
              : "Public articles only, no customer details."
          }
        />
        {draft.signedIn ? (
          <ClaimsEditor rows={draft.claims} onChange={(claims) => set({ claims })} locked={false} />
        ) : null}
        {fieldError("identity") ? <FormAlert>{fieldError("identity")}</FormAlert> : null}
      </div>

      <HistoryEditor turns={draft.history} onChange={(history) => set({ history })} error={fieldError("history")} />

      <Field
        label="Reference answer"
        hint="Optional. What a right answer says; the judge compares the agent's answer with it."
        error={fieldError("reference_answer")}
      >
        <Textarea
          value={draft.referenceAnswer}
          onChange={(event) => set({ referenceAnswer: event.target.value })}
          rows={2}
          maxLength={2000}
          placeholder="Annual plans can be refunded within 30 days of renewal."
        />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <ChipField
          label="Must include"
          values={draft.mustInclude}
          onChange={(mustInclude) => set({ mustInclude })}
          max={10}
          maxLength={200}
          placeholder="30 days"
          hint="Phrases a right reply contains. Case and spacing do not matter."
          error={fieldError("must_include")}
        />
        <ChipField
          label="Must not include"
          values={draft.mustNotInclude}
          onChange={(mustNotInclude) => set({ mustNotInclude })}
          max={10}
          maxLength={200}
          placeholder="guarantee"
          hint="Phrases that make any reply fail, such as a promise you never make."
          error={fieldError("must_not_include")}
        />
      </div>

      <Field
        label="Gold documents"
        hint={
          documents.length === 0
            ? "Teach the agent first: documents come from the Knowledge page."
            : "The documents a right answer comes from. Each run checks that search finds one in its top 8."
        }
        error={fieldError("gold_document_ids")}
      >
        <Select
          value=""
          disabled={available.length === 0 || draft.gold.length >= 10}
          onChange={(event) => {
            if (event.target.value) set({ gold: [...draft.gold, event.target.value] });
          }}
        >
          <option value="">{available.length === 0 ? "No more documents" : "Add a document"}</option>
          {available.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.title}
              {doc.title !== doc.source ? ` (${doc.source})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      {draft.gold.length > 0 ? (
        <ul aria-label="Chosen gold documents" className="-mt-4 flex flex-wrap gap-1.5">
          {draft.gold.map((id) => (
            <li
              key={id}
              className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-sm border border-line bg-surface-2 pl-2 text-sm text-ink"
            >
              <span className="truncate">{titles.get(id) ?? "Removed document"}</span>
              <button
                type="button"
                aria-label={`Remove ${titles.get(id) ?? "document"}`}
                onClick={() => set({ gold: draft.gold.filter((g) => g !== id) })}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:bg-line hover:text-ink"
              >
                <XIcon aria-hidden="true" className="size-3" weight="bold" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <ChipField
        label="Tags"
        values={draft.tags}
        onChange={(tags) => set({ tags })}
        max={10}
        maxLength={40}
        placeholder="refunds"
        hint="Optional, to find related cases."
        error={fieldError("tags")}
      />
    </div>
  );
}

function HistoryEditor({
  turns,
  onChange,
  error,
}: {
  turns: Turn[];
  onChange: (turns: Turn[]) => void;
  error?: string;
}) {
  const update = (id: number, change: Partial<Turn>) =>
    onChange(turns.map((turn) => (turn.id === id ? { ...turn, ...change } : turn)));
  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className="mb-1 text-sm font-medium text-ink">Earlier in the conversation</legend>
      <p className="text-sm text-ink-muted">
        Optional. Turns before the question, for a follow-up such as &ldquo;and on Team?&rdquo;.
      </p>
      {turns.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {turns.map((turn, index) => (
            <li key={turn.id} className="flex items-start gap-2">
              <Select
                size="sm"
                aria-label={`Turn ${index + 1}: who`}
                value={turn.role}
                onChange={(event) => update(turn.id, { role: event.target.value as Turn["role"] })}
                className="w-32 shrink-0"
              >
                <option value="visitor">Customer</option>
                <option value="agent">Agent</option>
              </Select>
              <Textarea
                aria-label={`Turn ${index + 1}: what was said`}
                value={turn.content}
                onChange={(event) => update(turn.id, { content: event.target.value })}
                rows={1}
                maxLength={2000}
                className="min-h-8 py-1.5 text-sm sm:text-sm"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove turn ${index + 1}`}
                onClick={() => onChange(turns.filter((other) => other.id !== turn.id))}
                className="size-8 shrink-0"
              >
                <XIcon aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      {turns.length < MAX_TURNS ? (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start"
          icon={<PlusIcon aria-hidden="true" className="size-4" />}
          onClick={() => {
            const last = turns.at(-1)?.role;
            onChange([
              ...turns,
              {
                id: Math.max(0, ...turns.map((t) => t.id)) + 1,
                role: last === "visitor" ? "agent" : "visitor",
                content: "",
              },
            ]);
          }}
        >
          Add an earlier turn
        </Button>
      ) : null}
    </fieldset>
  );
}

/** Add a case to a set, or edit one. Mount with a new key per opening for fresh state. */
export function CaseDialog({
  open,
  onClose,
  setId,
  existing,
  documents,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  setId: string;
  existing?: EvalCase;
  documents: EvalDocument[];
  onSaved: (saved: EvalCase) => void;
}) {
  const form = useApiForm();
  const [draft, setDraft] = useState(() => caseDraft(existing));
  const draftCase = existing?.status === "draft";

  async function save(approve: boolean) {
    if (!form.check(caseProblems(draft))) return;
    const body = caseBody(draft);
    await form.run(
      () =>
        request(
          existing
            ? api.PATCH("/v1/evals/cases/{case_id}", {
                params: { path: { case_id: existing.id } },
                body: approve ? { ...body, status: "active" } : body,
              })
            : api.POST("/v1/evals/sets/{set_id}/cases", { params: { path: { set_id: setId } }, body }),
        ),
      onSaved,
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={existing ? (draftCase ? "Review draft" : "Edit case") : "Add a case"}
      description={
        draftCase
          ? "Written by the model from one of your passages. Check it, then approve it so runs use it."
          : "A question and what the agent should do with it."
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
        noValidate
      >
        <DialogBody className="flex flex-col gap-6">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <CaseFields draft={draft} onChange={setDraft} documents={documents} fieldError={form.fieldError} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {draftCase ? (
            <>
              <Button type="submit" variant="secondary" loading={form.pending}>
                Save draft
              </Button>
              <Button loading={form.pending} onClick={() => void save(true)}>
                Save and approve
              </Button>
            </>
          ) : (
            <Button type="submit" loading={form.pending}>
              {existing ? "Save changes" : "Add case"}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}
