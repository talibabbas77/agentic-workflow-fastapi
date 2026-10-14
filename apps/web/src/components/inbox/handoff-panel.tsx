"use client";

import type {
  Assignee,
  HandoffNote,
  HandoffStatus,
  InboxDetail,
  InboxUpdate,
  Priority,
  TicketType,
} from "@docent/api-client";
import {
  ClockCounterClockwiseIcon,
  EnvelopeSimpleIcon,
  NoteIcon,
  ShieldCheckIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Loading } from "@/components/ui/loading";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";
import { priorityOptions, statuses } from "./inbox-meta";

const sentiment = { calm: "Calm", frustrated: "Frustrated", angry: "Angry", unknown: "Not clear" } as const;

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <Card aria-labelledby={id}>
      <CardHeader className="px-5 py-3.5">
        <CardTitle id={id} as="h2" className="text-base font-semibold">
          {title}
        </CardTitle>
      </CardHeader>
      <CardBody className="px-5 py-4">{children}</CardBody>
    </Card>
  );
}

function Row({ term, children, mono }: { term: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd dir="auto" className={cn("break-words text-ink", mono && "font-mono text-sm")}>
        {children}
      </dd>
    </div>
  );
}

/** Status, assignee, priority. Each change saves at once. */
export function Handling({
  detail,
  assignees,
  saving,
  onUpdate,
}: {
  detail: InboxDetail;
  assignees: Assignee[];
  saving: boolean;
  onUpdate: (body: InboxUpdate) => void;
}) {
  const item = detail.item;
  const me = assignees.find((a) => a.is_you);
  const assignee = item.assignee?.id ?? "";
  const othersLocked = !detail.can_assign_others;
  // Agents can take a handoff nobody has, or let go of their own, but not someone else's.
  const heldByOther = othersLocked && assignee !== "" && assignee !== me?.id;
  return (
    <Section title="Handling" id="handling-heading">
      <div className="flex flex-col gap-4" aria-busy={saving || undefined}>
        <Field label="Status">
          <Select
            value={item.status}
            disabled={saving}
            onChange={(event) => onUpdate({ status: event.target.value as HandoffStatus })}
          >
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Assigned to"
          hint={
            heldByOther
              ? "Only owners and admins can take a handoff from someone else."
              : othersLocked
                ? "Owners and admins can assign it to someone else."
                : undefined
          }
        >
          <Select
            value={assignee}
            disabled={saving || heldByOther}
            onChange={(event) => onUpdate({ assignee_user_id: event.target.value || null })}
          >
            <option value="">Nobody</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id} disabled={othersLocked && !a.is_you && a.id !== assignee}>
                {a.is_you ? `${a.name} (you)` : a.name}
              </option>
            ))}
          </Select>
        </Field>
        {me && assignee !== me.id && !heldByOther ? (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={saving}
            onClick={() => onUpdate({ assignee_user_id: me.id })}
          >
            Assign to me
          </Button>
        ) : null}
        <Field label="Priority">
          <Select
            value={item.priority}
            disabled={saving}
            onChange={(event) => onUpdate({ priority: event.target.value as Priority })}
          >
            {priorityOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Section>
  );
}

export function Summary({ detail }: { detail: InboxDetail }) {
  const summary = detail.summary;
  return (
    <Section title="Summary" id="summary-heading">
      {summary ? (
        <dl className="flex flex-col gap-3 text-base">
          <Row term="Issue">{summary.issue}</Row>
          <Row term="Already tried">{summary.tried}</Row>
          <Row term="About the customer">{summary.user_context}</Row>
          <Row term="Mood">{sentiment[summary.sentiment]}</Row>
          <Row term="Next step">{summary.suggested_next_step}</Row>
        </dl>
      ) : detail.item.summary_ready ? (
        <p className="text-base text-ink-muted">No summary for this handoff.</p>
      ) : (
        <Loading label="Writing the summary" className="flex flex-col gap-3">
          <p aria-hidden="true" className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="spinner text-xs" />
            The agent is writing a summary for your team
          </p>
          {["w-4/5", "w-full", "w-2/3"].map((width, i) => (
            <Skeleton key={i} className={`h-4 ${width}`} />
          ))}
        </Loading>
      )}
    </Section>
  );
}

export function Customer({ detail }: { detail: InboxDetail }) {
  const now = useNow();
  const customer = detail.customer;
  const claims = Object.entries(detail.claims);
  return (
    <Section title="Customer" id="customer-heading">
      <dl className="flex flex-col gap-3 text-base">
        {customer ? (
          <>
            <Row term="Name">{customer.name ?? "Not given"}</Row>
            {customer.email ? <Row term="Account email">{customer.email}</Row> : null}
            <Row term="Account id" mono>
              {customer.external_id}
            </Row>
            <Row term="First seen">{formatRelative(customer.first_seen_at, now)}</Row>
          </>
        ) : (
          <Row term="Visitor">
            {detail.item.channel !== "preview"
              ? "Anonymous visitor"
              : detail.claims.name
                ? `${detail.claims.name}, simulated in the preview`
                : "Your team, in the preview"}
          </Row>
        )}
        <Row term="Replies go to">
          {detail.item.contact_email ? (
            <span className="inline-flex items-center gap-1.5">
              <EnvelopeSimpleIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
              {detail.item.contact_email}
            </span>
          ) : (
            <span className="text-ink-muted">No email yet</span>
          )}
        </Row>
      </dl>
      {claims.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <ShieldCheckIcon aria-hidden="true" className="size-4 text-ink-muted" />
            Verified details
          </p>
          <p className="text-sm text-ink-muted">Signed by your server, so the customer could not change them.</p>
          <dl className="flex flex-col gap-1.5">
            {claims.map(([key, value]) => (
              <div key={key} className="flex flex-wrap gap-x-2 text-sm">
                <dt className="font-mono text-ink-muted">{key}</dt>
                <dd dir="auto" className="min-w-0 font-mono break-all text-ink">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Section>
  );
}

/** The ticket type and the details it collects. Saved with one button. */
export function TicketDetails({
  detail,
  ticketTypes,
  onUpdate,
  onSaved,
}: {
  detail: InboxDetail;
  ticketTypes: TicketType[];
  onUpdate: (body: InboxUpdate) => void;
  onSaved: (detail: InboxDetail) => void;
}) {
  const form = useApiForm();
  const typeId = detail.item.ticket_type?.id ?? "";
  const [values, setValues] = useState<Record<string, string>>(detail.fields);
  const fields = detail.ticket_type_fields;
  const dirty = fields.some((f) => (values[f.key] ?? "") !== (detail.fields[f.key] ?? ""));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = fields.filter((f) => f.required && !(values[f.key] ?? "").trim());
    if (!form.check({ fields: missing.length > 0 && `Fill in ${missing.map((f) => f.label).join(", ")}.` })) return;
    await form.run(
      () =>
        request(
          api.PATCH("/v1/inbox/{escalation_id}", {
            params: { path: { escalation_id: detail.item.id } },
            body: { fields: Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? "").trim()])) },
          }),
        ),
      onSaved,
    );
  }

  return (
    <Section title="Ticket" id="ticket-heading">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Ticket type">
          <Select value={typeId} onChange={(event) => onUpdate({ ticket_type_id: event.target.value || null })}>
            <option value="">No ticket type</option>
            {ticketTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.active ? "" : " (off)"}
              </option>
            ))}
          </Select>
        </Field>
        {fields.map((f) => (
          <Field key={f.key} label={f.required ? `${f.label} (required)` : f.label}>
            {f.type === "select" ? (
              <Select
                value={values[f.key] ?? ""}
                onChange={(event) => setValues((v) => ({ ...v, [f.key]: event.target.value }))}
              >
                <option value="">Not set</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={f.type === "email" ? "email" : f.type === "number" ? "number" : "text"}
                value={values[f.key] ?? ""}
                maxLength={500}
                onChange={(event) => setValues((v) => ({ ...v, [f.key]: event.target.value }))}
              />
            )}
          </Field>
        ))}
        {form.fieldError("fields") || form.formError ? (
          <FormAlert>{form.fieldError("fields") ?? form.formError}</FormAlert>
        ) : null}
        {fields.length > 0 ? (
          <Button type="submit" variant="secondary" size="sm" className="self-start" loading={form.pending} disabled={!dirty}>
            Save details
          </Button>
        ) : typeId ? (
          <p className="text-sm text-ink-muted">This ticket type collects no details.</p>
        ) : null}
      </form>
    </Section>
  );
}

export function Notes({
  detail,
  onAdded,
  onDeleted,
}: {
  detail: InboxDetail;
  onAdded: (note: HandoffNote) => void;
  onDeleted: (note: HandoffNote) => void;
}) {
  const now = useNow();
  const form = useApiForm();
  const [body, setBody] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.check({ body: !body.trim() && "Write the note first." })) return;
    await form.run(
      () =>
        request(
          api.POST("/v1/inbox/{escalation_id}/notes", {
            params: { path: { escalation_id: detail.item.id } },
            body: { body: body.trim() },
          }),
        ),
      (note) => {
        setBody("");
        onAdded(note);
      },
    );
  }

  async function remove(note: HandoffNote) {
    const result = await request(
      api.DELETE("/v1/inbox/{escalation_id}/notes/{note_id}", {
        params: { path: { escalation_id: detail.item.id, note_id: note.id } },
      }),
    );
    if (result.ok) onDeleted(note);
  }

  return (
    <Section title="Internal notes" id="notes-heading">
      <div className="flex flex-col gap-4">
        {detail.notes.length > 0 ? (
          <ul aria-label="Notes" className="flex flex-col gap-3">
            {detail.notes.map((note) => (
              <li key={note.id} className="flex flex-col gap-1 rounded-md border border-line bg-paper px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-ink-muted">
                    <span className="font-medium text-ink">{note.author?.name ?? "Former member"}</span>,{" "}
                    {formatRelative(note.created_at, now)}
                  </p>
                  {note.can_delete ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-my-1.5 -mr-2 size-7"
                      aria-label="Delete note"
                      onClick={() => void remove(note)}
                    >
                      <TrashIcon aria-hidden="true" className="size-4" />
                    </Button>
                  ) : null}
                </div>
                <p dir="auto" className="text-base break-words whitespace-pre-wrap text-ink">
                  {note.body}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <NoteIcon aria-hidden="true" className="size-4" />
            Notes stay with your team. The customer never sees them.
          </p>
        )}
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
          <Field label="Add a note" error={form.fieldError("body") ?? form.formError ?? undefined}>
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={4000} />
          </Field>
          <Button type="submit" variant="secondary" size="sm" className="self-start" loading={form.pending}>
            Add note
          </Button>
        </form>
      </div>
    </Section>
  );
}

/** What happened, oldest first: routing, assignment, status, replies, and emails to the team. */
export function Activity({ detail }: { detail: InboxDetail }) {
  const now = useNow();
  const entries = [
    ...detail.history.map((h) => ({
      id: h.id,
      at: h.created_at,
      text: h.text,
      who: h.actor ?? "Docent",
      problem: null as string | null,
    })),
    ...detail.deliveries
      .filter((d) => d.kind !== "reply")
      .map((d) => ({
        id: d.id,
        at: d.created_at,
        text:
          d.status === "sent"
            ? `Emailed ${d.to_hint} about it`
            : d.status === "dead"
              ? `Could not email ${d.to_hint}`
              : d.status === "retrying"
                ? `Emailing ${d.to_hint}, trying again`
                : `Emailing ${d.to_hint}`,
        who: "Docent",
        problem: d.status === "dead" || d.status === "retrying" ? d.last_error : null,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <Section title="Activity" id="activity-heading">
      {entries.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <ClockCounterClockwiseIcon aria-hidden="true" className="size-4" />
          Nothing yet. Assignments, status changes, and replies show here.
        </p>
      ) : (
        <ol className="flex flex-col gap-3 border-l border-line pl-4">
          {entries.map((entry) => (
            <li key={entry.id} className="relative flex flex-col gap-0.5 text-sm">
              <span aria-hidden="true" className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-line-strong" />
              <p className="text-ink">{entry.text}</p>
              <p className="text-ink-muted">
                {entry.who}, {formatRelative(entry.at, now)}
              </p>
              {entry.problem ? (
                <p className="flex items-start gap-1.5 text-rust">
                  <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
                  {entry.problem}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
