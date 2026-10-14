"use client";

import type {
  Assignee,
  ClaimCondition,
  HandoffReason,
  Priority,
  RoutingRule,
  RoutingRuleInput,
  SlackChannel,
  TicketType,
  Webhook,
} from "@docent/api-client";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { reasonLabel, reasons, priorityLabel, priorityOptions } from "@/components/inbox/inbox-meta";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChipField } from "@/components/ui/chip-field";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { useApiForm } from "@/lib/use-api-form";

export type Lookups = {
  ticketTypes: TicketType[];
  assignees: Assignee[];
  channels: SlackChannel[];
  webhooks: Webhook[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLAIM_KEY = /^[a-z][a-z0-9_]{0,39}$/;

const opLabel: Record<ClaimCondition["op"], string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  exists: "is set",
};

function joinOr(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

function joinAnd(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "the ticket type is Billing and plan is Enterprise", or null for any handoff. */
export function whenText(rule: RoutingRule, lookups: Lookups) {
  const parts: string[] = [];
  if (rule.ticket_type_ids.length > 0) {
    const names = rule.ticket_type_ids.map(
      (id) => lookups.ticketTypes.find((t) => t.id === id)?.name ?? "a deleted ticket type",
    );
    parts.push(`the ticket type is ${joinOr(names)}`);
  }
  if (rule.reasons.length > 0) {
    parts.push(`the reason is ${joinOr(rule.reasons.map((r) => reasonLabel[r].toLowerCase()))}`);
  }
  for (const c of rule.claim_conditions) {
    parts.push(c.op === "exists" ? `${c.key} is set` : `${c.key} ${opLabel[c.op]} ${c.value}`);
  }
  return parts.length > 0 ? joinAnd(parts) : null;
}

export function thenText(rule: RoutingRule, lookups: Lookups) {
  const parts: string[] = [];
  if (rule.assign_user_id) {
    const who = lookups.assignees.find((a) => a.id === rule.assign_user_id)?.name ?? "a former member";
    parts.push(`assign to ${who}`);
  }
  if (rule.set_priority) parts.push(`set priority to ${priorityLabel[rule.set_priority]}`);
  if (rule.notify_emails.length > 0) parts.push(`email ${joinAnd(rule.notify_emails)}`);
  if (rule.notify_channel_id) {
    const channel = lookups.channels.find((c) => c.id === rule.notify_channel_id)?.name ?? "a deleted channel";
    parts.push(`post to Slack ${channel}`);
  }
  if (rule.webhook_id) {
    const hook = lookups.webhooks.find((w) => w.id === rule.webhook_id);
    parts.push(`send to the webhook ${hook ? hook.description || hook.url_hint : "that was deleted"}`);
  }
  return joinAnd(parts);
}

function toInput(rule: RoutingRule, active = rule.active): RoutingRuleInput {
  return {
    name: rule.name,
    active,
    ticket_type_ids: rule.ticket_type_ids,
    reasons: rule.reasons,
    claim_conditions: rule.claim_conditions,
    assign_user_id: rule.assign_user_id,
    set_priority: rule.set_priority,
    notify_emails: rule.notify_emails,
    notify_channel_id: rule.notify_channel_id,
    webhook_id: rule.webhook_id,
  };
}

/** Ordered rules. The first one that matches a new handoff decides what happens to it. */
export function RulesCard({
  rules,
  onRules,
  lookups,
  canManage,
}: {
  rules: RoutingRule[];
  onRules: (rules: RoutingRule[]) => void;
  lookups: Lookups;
  canManage: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<RoutingRule | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [deleting, setDeleting] = useState<RoutingRule | null>(null);
  const [busy, setBusy] = useState(false);

  function openDialog(rule: RoutingRule | null) {
    setEditing(rule);
    setDialogKey((n) => n + 1);
    setOpen(true);
  }

  async function moveRule(index: number, step: -1 | 1) {
    const next = [...rules];
    const [rule] = next.splice(index, 1);
    next.splice(index + step, 0, rule!);
    setBusy(true);
    onRules(next);
    const result = await request(api.PUT("/v1/automation/rules/order", { body: { ids: next.map((r) => r.id) } }));
    setBusy(false);
    if (result.ok) {
      onRules(result.data);
      // Keep focus on the same button of the moved rule so arrows can be pressed again.
      requestAnimationFrame(() =>
        document.getElementById(`rule-${rule!.id}-${step < 0 ? "up" : "down"}`)?.focus(),
      );
    } else {
      onRules(rules);
      toast({ tone: "error", title: "Could not reorder", description: result.error.message });
    }
  }

  async function toggle(rule: RoutingRule, active: boolean) {
    const result = await request(
      api.PUT("/v1/automation/rules/{rule_id}", {
        params: { path: { rule_id: rule.id } },
        body: toInput(rule, active),
      }),
    );
    if (result.ok) onRules(rules.map((r) => (r.id === rule.id ? result.data : r)));
    else toast({ tone: "error", title: "Could not change the rule", description: result.error.message });
  }

  return (
    <Card aria-labelledby="rules-heading">
      <CardHeader className="sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1">
          <CardTitle id="rules-heading">Routing rules</CardTitle>
          <CardDescription>
            When a handoff arrives and the agent has sorted it into a ticket type, Docent checks these rules from the top.
            The first one that matches decides what happens.
          </CardDescription>
        </div>
        {canManage ? (
          <Button
            className="shrink-0 self-start sm:self-auto"
            onClick={() => openDialog(null)}
            icon={<PlusIcon aria-hidden="true" className="size-4" />}
          >
            Add rule
          </Button>
        ) : null}
      </CardHeader>
      {rules.length === 0 ? (
        <p className="px-6 py-6 text-base text-ink-muted">
          No rules yet. Without one, each handoff goes to the people its ticket type emails, or to owners and admins
          when nobody else would hear about it.
        </p>
      ) : (
        <ol aria-label="Rules, checked in this order" aria-busy={busy || undefined}>
          {rules.map((rule, index) => {
            const when = whenText(rule, lookups);
            return (
              <li
                key={rule.id}
                className={cn(
                  "flex flex-col gap-3 border-b border-line px-6 py-4 last:border-b-0 sm:flex-row sm:items-start sm:gap-4",
                  !rule.active && "bg-surface-2/50",
                )}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-line-strong text-sm font-medium text-ink-muted tabular-nums"
                >
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{rule.name}</span>
                    {rule.active ? null : (
                      <span className="rounded-sm border border-line-strong px-1.5 text-xs text-ink-muted">Off</span>
                    )}
                  </p>
                  <p className="text-base text-ink">
                    <span className="font-semibold">When</span> {when ?? "any handoff comes in"}
                  </p>
                  <p className="text-base text-ink">
                    <span className="font-semibold">Then</span> {thenText(rule, lookups)}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                    <Switch checked={rule.active} onChange={(on) => void toggle(rule, on)} label={<span className="sr-only">Active: {rule.name}</span>} />
                    <Button
                      id={`rule-${rule.id}-up`}
                      variant="ghost"
                      size="icon"
                      disabled={index === 0 || busy}
                      aria-label={`Move ${rule.name} up`}
                      onClick={() => void moveRule(index, -1)}
                    >
                      <ArrowUpIcon aria-hidden="true" className="size-4.5" />
                    </Button>
                    <Button
                      id={`rule-${rule.id}-down`}
                      variant="ghost"
                      size="icon"
                      disabled={index === rules.length - 1 || busy}
                      aria-label={`Move ${rule.name} down`}
                      onClick={() => void moveRule(index, 1)}
                    >
                      <ArrowDownIcon aria-hidden="true" className="size-4.5" />
                    </Button>
                    <PopoverMenu
                      label={`Actions for ${rule.name}`}
                      align="end"
                      className="w-44"
                      trigger={(props) => (
                        <Button variant="ghost" size="icon" {...props} aria-label={`Actions for ${rule.name}`}>
                          <DotsThreeIcon aria-hidden="true" className="size-4.5" weight="bold" />
                        </Button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem
                            icon={<PencilSimpleIcon aria-hidden="true" className="size-4 text-ink-muted" />}
                            onClick={() => {
                              close();
                              openDialog(rule);
                            }}
                          >
                            Edit
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem
                            className="text-rust"
                            icon={<TrashIcon aria-hidden="true" className="size-4" />}
                            onClick={() => {
                              close();
                              setDeleting(rule);
                            }}
                          >
                            Delete
                          </MenuItem>
                        </>
                      )}
                    </PopoverMenu>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {canManage ? (
        <>
          <RuleDialog
            key={dialogKey}
            open={open}
            editing={editing}
            lookups={lookups}
            onClose={() => setOpen(false)}
            onSaved={(saved) => {
              setOpen(false);
              onRules(editing ? rules.map((r) => (r.id === saved.id ? saved : r)) : [...rules, saved]);
              toast({ tone: "success", title: editing ? "Rule saved" : "Rule added", description: saved.name });
            }}
          />
          <DeleteRule
            target={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={(rule) => {
              setDeleting(null);
              onRules(rules.filter((r) => r.id !== rule.id));
              toast({ tone: "success", title: "Rule deleted", description: rule.name });
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

type ConditionRow = ClaimCondition & { id: number };

function RuleDialog({
  open,
  editing,
  lookups,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: RoutingRule | null;
  lookups: Lookups;
  onClose: () => void;
  onSaved: (rule: RoutingRule) => void;
}) {
  const form = useApiForm();
  const [name, setName] = useState(editing?.name ?? "");
  const [ticketType, setTicketType] = useState(editing?.ticket_type_ids[0] ?? "");
  const [reason, setReason] = useState<HandoffReason | "">(editing?.reasons[0] ?? "");
  const [conditions, setConditions] = useState<ConditionRow[]>(
    () => editing?.claim_conditions.map((c, i) => ({ ...c, id: i })) ?? [],
  );
  const [nextId, setNextId] = useState(conditions.length);
  const [assignee, setAssignee] = useState(editing?.assign_user_id ?? "");
  const [priority, setPriority] = useState<Priority | "">(editing?.set_priority ?? "");
  const [emails, setEmails] = useState(editing?.notify_emails ?? []);
  const [channel, setChannel] = useState(editing?.notify_channel_id ?? "");
  const [webhook, setWebhook] = useState(editing?.webhook_id ?? "");
  const [active, setActive] = useState(editing?.active ?? true);

  function setCondition(id: number, patch: Partial<ClaimCondition>) {
    setConditions((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const badKey = conditions.find((c) => !CLAIM_KEY.test(c.key));
    const noValue = conditions.find((c) => c.op !== "exists" && !c.value.trim());
    const ok = form.check({
      name: !name.trim() && "Name the rule.",
      conditions:
        (badKey && `Use a claim name such as plan or account_id, not "${badKey.key || "nothing"}".`) ||
        (noValue && `Give a value to compare ${noValue.key} with.`),
      actions:
        !assignee && !priority && emails.length === 0 && !channel && !webhook && "Choose at least one thing to do.",
    });
    if (!ok) return;
    // A rule keeps any extra ticket types or reasons it was given through the API.
    const body: RoutingRuleInput = {
      name: name.trim(),
      active,
      ticket_type_ids: ticketType ? [ticketType, ...(editing?.ticket_type_ids.slice(1) ?? [])] : [],
      reasons: reason ? [reason, ...(editing?.reasons.slice(1) ?? [])] : [],
      claim_conditions: conditions.map(({ key, op, value }) => ({ key, op, value: op === "exists" ? "" : value.trim() })),
      assign_user_id: assignee || null,
      set_priority: priority || null,
      notify_emails: emails,
      notify_channel_id: channel || null,
      webhook_id: webhook || null,
    };
    await form.run(
      () =>
        request(
          editing
            ? api.PUT("/v1/automation/rules/{rule_id}", { params: { path: { rule_id: editing.id } }, body })
            : api.POST("/v1/automation/rules", { body }),
        ),
      onSaved,
    );
  }

  const actionsError = form.fieldError("actions");
  const conditionsError = form.fieldError("conditions") ?? form.fieldError("claim_conditions");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${editing.name}` : "Add a rule"}
      description="Leave a condition on Any to match every handoff. All the conditions you set must match."
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-6">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field label="Name" error={form.fieldError("name")}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Enterprise billing to Ana"
              autoComplete="off"
              autoFocus
            />
          </Field>

          <fieldset className="flex flex-col gap-4 rounded-md border border-line px-4 pt-2 pb-4">
            <legend className="px-1 text-base font-semibold text-ink">When a handoff comes in and</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ticket type is" error={form.fieldError("ticket_type_ids")}>
                <Select value={ticketType} onChange={(event) => setTicketType(event.target.value)}>
                  <option value="">Any ticket type</option>
                  {lookups.ticketTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reason is">
                <Select value={reason} onChange={(event) => setReason(event.target.value as HandoffReason | "")}>
                  <option value="">Any reason</option>
                  {reasons.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-ink">Customer details</p>
              <p className="text-sm text-ink-muted">
                Compared with the verified claims your server signs, such as plan or account_id. Anonymous visitors
                have none.
              </p>
              {conditions.map((row) => (
                <div
                  key={row.id}
                  role="group"
                  aria-label={`Condition on ${row.key || "a claim"}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto]"
                >
                  <Input
                    aria-label="Claim"
                    value={row.key}
                    onChange={(event) => setCondition(row.id, { key: event.target.value.trim().toLowerCase() })}
                    placeholder="plan"
                    maxLength={40}
                    className="font-mono"
                  />
                  <Select
                    aria-label="Compare"
                    className="max-sm:order-3"
                    value={row.op}
                    onChange={(event) => setCondition(row.id, { op: event.target.value as ClaimCondition["op"] })}
                  >
                    {Object.entries(opLabel).map(([op, label]) => (
                      <option key={op} value={op}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label="Value"
                    className="max-sm:order-4"
                    value={row.op === "exists" ? "" : row.value}
                    disabled={row.op === "exists"}
                    onChange={(event) => setCondition(row.id, { value: event.target.value })}
                    placeholder={row.op === "exists" ? "" : "Enterprise"}
                    maxLength={200}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="max-sm:order-2"
                    aria-label={`Remove the condition on ${row.key || "this claim"}`}
                    onClick={() => setConditions((rows) => rows.filter((r) => r.id !== row.id))}
                  >
                    <XIcon aria-hidden="true" className="size-4.5" />
                  </Button>
                </div>
              ))}
              {conditionsError ? <FormAlert>{conditionsError}</FormAlert> : null}
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                disabled={conditions.length >= 10}
                icon={<PlusIcon aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setConditions((rows) => [...rows, { id: nextId, key: "", op: "equals", value: "" }]);
                  setNextId((n) => n + 1);
                }}
              >
                Add a condition
              </Button>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4 rounded-md border border-line px-4 pt-2 pb-4">
            <legend className="px-1 text-base font-semibold text-ink">Then</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Assign to" error={form.fieldError("assign_user_id")}>
                <Select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                  <option value="">Nobody</option>
                  {lookups.assignees.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Set priority">
                <Select value={priority} onChange={(event) => setPriority(event.target.value as Priority | "")}>
                  <option value="">Keep the ticket type&apos;s</option>
                  {priorityOptions.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Post to Slack" error={form.fieldError("notify_channel_id")}>
                <Select value={channel} onChange={(event) => setChannel(event.target.value)}>
                  <option value="">No channel</option>
                  {lookups.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Send to webhook" error={form.fieldError("webhook_id")}>
                <Select value={webhook} onChange={(event) => setWebhook(event.target.value)}>
                  <option value="">No webhook</option>
                  {lookups.webhooks.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.description || w.url_hint}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <ChipField
              label="Email"
              values={emails}
              onChange={setEmails}
              max={10}
              maxLength={254}
              validate={(email) => (EMAIL.test(email) ? null : `${email} is not an email address.`)}
              placeholder="name@company.com"
              error={form.fieldError("notify_emails")}
              hint="Besides the ticket type's list. The assignee is emailed too."
            />
            {actionsError ? <FormAlert>{actionsError}</FormAlert> : null}
          </fieldset>
          <Switch checked={active} onChange={setActive} label="Active" hint="Rules that are off are skipped." />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            {editing ? "Save rule" : "Add rule"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function DeleteRule({
  target,
  onClose,
  onDeleted,
}: {
  target: RoutingRule | null;
  onClose: () => void;
  onDeleted: (rule: RoutingRule) => void;
}) {
  const form = useApiForm();
  const [last, setLast] = useState(target);
  if (target && target !== last) setLast(target);
  const shown = target ?? last;
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={`Delete ${shown?.name ?? "this rule"}?`}
      description="New handoffs stop matching it right away. Handoffs it already routed keep their assignee."
    >
      {form.formError ? (
        <DialogBody className="pt-4 pb-2">
          <FormAlert>{form.formError}</FormAlert>
        </DialogBody>
      ) : (
        <div className="h-5" />
      )}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={form.pending}
          onClick={() => {
            if (!shown) return;
            void form.run(
              () => request(api.DELETE("/v1/automation/rules/{rule_id}", { params: { path: { rule_id: shown.id } } })),
              () => onDeleted(shown),
            );
          }}
        >
          Delete rule
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
