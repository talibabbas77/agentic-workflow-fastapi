"use client";

import type { AdminWorkspace, PaidPlanId } from "@docent/api-client";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";
import { api, request } from "@/lib/api/browser";
import { formatDate } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";

export type ActionKind = "trial" | "comp" | "end";

const DAY_MS = 86_400_000;
const MAX_TRIAL_DAYS = 30;
const MAX_COMP_DAYS = 365;

const paidPlans: { id: PaidPlanId; name: string }[] = [
  { id: "starter", name: "Starter" },
  { id: "growth", name: "Growth" },
  { id: "scale", name: "Scale" },
];

type ActionProps = {
  workspace: AdminWorkspace;
  open: boolean;
  onClose: () => void;
  onDone: (workspace: AdminWorkspace, message: { title: string; description: string }) => void;
};

/** "2026-11-13": a UTC day, as a date input wants it. */
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Add days to the trial. Mount it with a new key per opening for fresh state. */
export function ExtendTrialDialog({ workspace, open, onClose, onDone }: ActionProps) {
  const form = useApiForm();
  const now = useNow();
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const count = Number(days);
  const valid = Number.isInteger(count) && count >= 1 && count <= MAX_TRIAL_DAYS;
  const current = workspace.subscription.trial_ends_at;
  const base = now === null ? null : Math.max(current ? Date.parse(current) : now, now);
  const ends = valid && base !== null ? formatDate(new Date(base + count * DAY_MS).toISOString()) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = form.check({
      days: !valid && `Choose 1 to ${MAX_TRIAL_DAYS} days.`,
      reason: reason.trim().length < 3 && "Say why, in a few words. It goes in the audit log.",
    });
    if (!ok) return;
    await form.run(
      () =>
        request(
          api.POST("/v1/admin/workspaces/{tenant_id}/trial", {
            params: { path: { tenant_id: workspace.id } },
            body: { days: count, reason: reason.trim() },
          }),
        ),
      (next) =>
        onDone(next, {
          title: "Trial extended",
          description: next.subscription.trial_ends_at
            ? `${next.name}'s trial now ends on ${formatDate(next.subscription.trial_ends_at)}.`
            : `${next.name}'s trial is longer now.`,
        }),
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Extend the trial"
      description={`Give ${workspace.name} more days to try Docent before it pays.`}
    >
      <form onSubmit={submit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field
            label="Days to add"
            error={form.fieldError("days")}
            hint={
              ends
                ? `The trial will end on ${ends}.${current && Date.parse(current) < (now ?? 0) ? " It has ended, so it restarts from today." : ""}`
                : `1 to ${MAX_TRIAL_DAYS} days.`
            }
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_TRIAL_DAYS}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="w-28"
              autoFocus
            />
          </Field>
          <ReasonField value={reason} onChange={setReason} error={form.fieldError("reason")} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            {valid ? `Extend by ${count} ${count === 1 ? "day" : "days"}` : "Extend trial"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** A paid plan at no charge until a chosen day. Mount it with a new key per opening. */
export function CompDialog({ workspace, open, onClose, onDone }: ActionProps) {
  const form = useApiForm();
  const currentPaid = paidPlans.find((plan) => plan.id === workspace.subscription.plan.id);
  // The dialog mounts fresh for each opening, so the day it opened is today.
  const [today] = useState(() => Date.now());
  const [planId, setPlanId] = useState<PaidPlanId>(currentPaid?.id ?? "growth");
  const [until, setUntil] = useState(() => isoDay(today + 30 * DAY_MS));
  const [reason, setReason] = useState("");
  const plan = paidPlans.find((p) => p.id === planId) ?? paidPlans[1]!;
  const min = isoDay(today + DAY_MS);
  const max = isoDay(today + MAX_COMP_DAYS * DAY_MS);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(until) && until >= min && until <= max;
  const untilLabel = validDate ? formatDate(`${until}T00:00:00Z`) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = form.check({
      until: !validDate && "Choose a day after today and within a year.",
      reason: reason.trim().length < 3 && "Say why, in a few words. It goes in the audit log.",
    });
    if (!ok) return;
    await form.run(
      () =>
        request(
          api.POST("/v1/admin/workspaces/{tenant_id}/comp", {
            params: { path: { tenant_id: workspace.id } },
            body: { plan_id: planId, until, reason: reason.trim() },
          }),
        ),
      (next) =>
        onDone(next, {
          title: `${plan.name} given until ${untilLabel ?? until}`,
          description: `${next.name} answers on ${plan.name} at no charge until then.`,
        }),
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Give a comped plan"
      description={`Put ${workspace.name} on a paid plan at no charge, until a day you choose.`}
    >
      <form onSubmit={submit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Plan" error={form.fieldError("plan_id")}>
              <Select value={planId} onChange={(event) => setPlanId(event.target.value as PaidPlanId)}>
                {paidPlans.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Until"
              error={form.fieldError("until")}
              hint="It ends at the start of this day, UTC."
            >
              <Input type="date" min={min} max={max} value={until} onChange={(event) => setUntil(event.target.value)} />
            </Field>
          </div>
          <Consequences>
            <li>
              {workspace.name} gets {plan.name}&apos;s caps and limits right away. Nothing is charged, and Stripe is
              not involved.
            </li>
            <li>
              {untilLabel ? `On ${untilLabel}` : "On that day"}, the plan ends by itself. The agent then hands every
              message to the team until an owner chooses a plan.
            </li>
            {workspace.subscription.state === "trial" ? <li>The trial ends now; the comped plan replaces it.</li> : null}
          </Consequences>
          <ReasonField value={reason} onChange={setReason} error={form.fieldError("reason")} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            Give {plan.name}
            {untilLabel ? ` until ${untilLabel}` : ""}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** End a comped plan now. Mount it with a new key per opening. */
export function EndCompDialog({ workspace, open, onClose, onDone }: ActionProps) {
  const form = useApiForm();
  const [reason, setReason] = useState("");
  const plan = workspace.subscription.plan.name;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = form.check({
      reason: reason.trim().length < 3 && "Say why, in a few words. It goes in the audit log.",
    });
    if (!ok) return;
    await form.run(
      () =>
        request(
          api.POST("/v1/admin/workspaces/{tenant_id}/comp/end", {
            params: { path: { tenant_id: workspace.id } },
            body: { reason: reason.trim() },
          }),
        ),
      (next) =>
        onDone(next, {
          title: "Comped plan ended",
          description: `${next.name} hands every message to its team until an owner chooses a plan.`,
        }),
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`End the comped ${plan} plan?`}
      description={`${workspace.name} stops getting ${plan} at no charge, starting now.`}
    >
      <form onSubmit={submit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <Consequences>
            <li>The agent stops answering and hands every message to the team as a handoff.</li>
            <li>Sources, settings, and conversations are kept. An owner can choose a plan on the billing page.</li>
          </Consequences>
          <ReasonField value={reason} onChange={setReason} error={form.fieldError("reason")} autoFocus />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button type="submit" variant="danger" loading={form.pending}>
            End comped plan
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function Consequences({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base text-ink-muted">{children}</ul>;
}

function ReasonField({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field
      label="Reason"
      error={error}
      hint="Required. Written to this workspace's audit log, with your name."
    >
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Design partner until the launch"
        autoFocus={autoFocus}
      />
    </Field>
  );
}
