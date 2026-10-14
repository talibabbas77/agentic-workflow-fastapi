"use client";

import type { EvalCasePrefill, EvalDocument, EvalSet } from "@docent/api-client";
import { ExamIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { useApiForm } from "@/lib/use-api-form";
import { caseBody, caseDraft, CaseFields, caseProblems, type CaseDraft } from "./case-editor";

const NEW_SET = "new";

type Loaded = { prefill: EvalCasePrefill; sets: EvalSet[]; documents: EvalDocument[] };

/**
 * "Add to eval set": turns a real conversation into a test case, filled in with
 * the customer's question, the turns before it, and their verified details.
 * Owners and admins only; the button is not shown to agents.
 */
export function AddToEvalSet({
  conversationId,
  messageId,
  children = "Add to eval set",
  compact = false,
}: {
  conversationId: string;
  messageId?: string;
  children?: ReactNode;
  /** A small text button, for a message in a transcript. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const show = () => {
    setKey((n) => n + 1);
    setOpen(true);
  };
  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={show}
          className="inline-flex items-center gap-1 rounded-sm font-medium transition-colors duration-150 hover:text-ink"
        >
          <ExamIcon aria-hidden="true" className="size-3.5" />
          {children}
        </button>
      ) : (
        <Button variant="secondary" size="sm" onClick={show} icon={<ExamIcon aria-hidden="true" className="size-4" />}>
          {children}
        </Button>
      )}
      {open ? (
        <AddToEvalSetDialog
          key={key}
          conversationId={conversationId}
          messageId={messageId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function AddToEvalSetDialog({
  conversationId,
  messageId,
  onClose,
}: {
  conversationId: string;
  messageId?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const form = useApiForm();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaseDraft | null>(null);
  const [setId, setSetId] = useState<string>("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const [prefill, sets, documents] = await Promise.all([
        request(
          api.GET("/v1/evals/prefill", {
            params: { query: { conversation_id: conversationId, ...(messageId ? { message_id: messageId } : {}) } },
          }),
        ),
        request(api.GET("/v1/evals/sets")),
        request(api.GET("/v1/evals/documents")),
      ]);
      if (!live) return;
      if (!prefill.ok || !sets.ok || !documents.ok) {
        const problem = [prefill, sets, documents].find((r) => !r.ok);
        setFailed(problem && !problem.ok ? problem.error.message : "Could not load the conversation.");
        return;
      }
      setLoaded({ prefill: prefill.data, sets: sets.data, documents: documents.data });
      setDraft(caseDraft(prefill.data));
      setSetId(sets.data[0]?.id ?? NEW_SET);
    })();
    return () => {
      live = false;
    };
  }, [conversationId, messageId]);

  async function save() {
    if (!loaded || !draft) return;
    const creating = setId === NEW_SET;
    if (!form.check({ ...caseProblems(draft), set_name: creating && !newName.trim() && "Name the new set." })) return;
    let target = loaded.sets.find((s) => s.id === setId) ?? null;
    if (creating) {
      const made = await request(api.POST("/v1/evals/sets", { body: { name: newName.trim(), description: "" } }));
      if (!made.ok) {
        form.check({ set_name: made.error.fields?.name ?? made.error.message });
        return;
      }
      target = made.data;
      setLoaded({ ...loaded, sets: [...loaded.sets, made.data] });
      setSetId(made.data.id);
    }
    if (!target) return;
    const chosen = target;
    await form.run(
      () =>
        request(
          api.POST("/v1/evals/sets/{set_id}/cases", {
            params: { path: { set_id: chosen.id } },
            body: {
              ...caseBody(draft),
              source_conversation_id: loaded.prefill.source_conversation_id,
              source_message_id: loaded.prefill.source_message_id,
            },
          }),
        ),
      () => {
        toast({ tone: "success", title: `Added to ${chosen.name}`, description: "It runs with the set from Evals." });
        onClose();
      },
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Add to eval set"
      description="This conversation becomes a test case. Check what should happen, then every run of the set asks it again."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
      >
        <DialogBody className="flex flex-col gap-6">
          {failed ? <FormAlert>{failed}</FormAlert> : null}
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          {!loaded && !failed ? (
            <p role="status" className="flex items-center gap-2.5 py-6 text-base text-ink-muted">
              <span aria-hidden="true" className="spinner text-xs text-rust" />
              Reading the conversation
            </p>
          ) : null}
          {loaded && draft ? (
            <>
              <div className={cn("grid gap-4", setId === NEW_SET && "sm:grid-cols-2")}>
                <Field label="Eval set" error={setId === NEW_SET ? undefined : form.fieldError("set_name")}>
                  <Select value={setId} onChange={(event) => setSetId(event.target.value)}>
                    {loaded.sets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value={NEW_SET}>A new set</option>
                  </Select>
                </Field>
                {setId === NEW_SET ? (
                  <Field label="New set name" error={form.fieldError("set_name")}>
                    <Input
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      maxLength={80}
                      placeholder="From the inbox"
                    />
                  </Field>
                ) : null}
              </div>
              <CaseFields draft={draft} onChange={setDraft} documents={loaded.documents} fieldError={form.fieldError} />
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending} disabled={!loaded}>
            Add case
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
