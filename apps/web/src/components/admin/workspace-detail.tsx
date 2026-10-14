"use client";

import type {
  AdminAuditEntry,
  AdminBillingEvent,
  AdminMember,
  AdminSubscription,
  AdminUsageMonth,
  AdminWidget,
  AdminWorkspace,
} from "@docent/api-client";
import { ArrowLeftIcon, CheckIcon, MinusIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMicros,
  formatPerReply,
  formatRelative,
  plural,
} from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { PrivacyNote, StatTile } from "./bits";
import { OutcomeBadge, StateBadge } from "./labels";
import { CompDialog, EndCompDialog, ExtendTrialDialog, type ActionKind } from "./workspace-actions";

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function WorkspaceDetail({ initial }: { initial: AdminWorkspace }) {
  const toast = useToast();
  const [ws, setWs] = useState(initial);
  const [open, setOpen] = useState<ActionKind | null>(null);
  const [opened, setOpened] = useState(0);
  const month = ws.this_month;
  const activity = ws.activity;

  function start(kind: ActionKind) {
    setOpened((n) => n + 1);
    setOpen(kind);
  }

  function done(next: AdminWorkspace, message: { title: string; description: string }) {
    setOpen(null);
    setWs(next);
    toast({ tone: "success", ...message });
  }

  const dialog = { workspace: ws, onClose: () => setOpen(null), onDone: done };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/workspaces"
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          All workspaces
        </Link>
        <PageHeader
          title={ws.name}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm">{ws.slug}</span>
              <span aria-hidden="true" className="text-ink-subtle">
                /
              </span>
              <span>Created {formatDate(ws.created_at)}</span>
            </span>
          }
          actions={<StateBadge state={ws.subscription.state} />}
        />
        <PrivacyNote />
      </div>

      {ws.status === "active" ? null : (
        <FormAlert tone="info">This workspace is {ws.status}. People in it cannot use Docent.</FormAlert>
      )}

      <section aria-labelledby="month-heading" className="flex flex-col gap-3">
        <h2 id="month-heading" className="text-lg text-ink">
          This month
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatTile
            label="Replies used"
            value={formatCount(month.replies_used)}
            note={month.replies_cap > 0 ? `of ${formatCount(month.replies_cap)} on the plan` : "Answers are off"}
          />
          <StatTile label="Model cost" value={formatMicros(month.cost_micros)} note="From usage events" />
          <StatTile
            label="Revenue"
            value={formatMicros(month.revenue_micros)}
            note={month.revenue_micros > 0 ? "The plan's monthly price, via Stripe" : "Nothing paid through Stripe"}
          />
          <StatTile label="Margin" value={formatMicros(month.margin_micros)} note="Revenue less model cost" />
          <StatTile
            label="Cost per reply"
            value={month.cost_per_reply_micros === null ? "No replies" : formatPerReply(month.cost_per_reply_micros)}
            note={
              month.cost_per_reply_micros === null
                ? "Nothing to compare this month"
                : month.anomaly
                  ? "More than 3 times the median: worth a look"
                  : "Within 3 times the median"
            }
            warn={month.anomaly}
          />
          <StatTile
            label="Conversations"
            value={formatCount(activity.conversations)}
            note={`${formatCount(activity.widget_conversations)} on the widget. ${formatCount(activity.handoffs)} ${plural(activity.handoffs, "handoff")}, ${formatCount(activity.open_handoffs)} open.`}
          />
        </dl>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SubscriptionCard sub={ws.subscription} />
        <ActionsCard ws={ws} onStart={start} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <UsageCard usage={ws.usage} />
        <KnowledgeCard ws={ws} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <MembersCard members={ws.members} />
        <WidgetsCard widgets={ws.widgets} />
      </div>

      <BillingEventsCard events={ws.billing_events} />
      <AuditCard entries={ws.audit} />

      {ws.actions.extend_trial ? (
        <ExtendTrialDialog key={`trial-${opened}`} open={open === "trial"} {...dialog} />
      ) : null}
      {ws.actions.give_comp ? <CompDialog key={`comp-${opened}`} open={open === "comp"} {...dialog} /> : null}
      {ws.actions.end_comp ? <EndCompDialog key={`end-${opened}`} open={open === "end"} {...dialog} /> : null}
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-3 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm text-ink-muted sm:w-40 sm:pt-px">{term}</dt>
      <dd className="min-w-0 text-base text-ink">{children}</dd>
    </div>
  );
}

function SubscriptionCard({ sub }: { sub: AdminSubscription }) {
  const price = sub.plan.price_usd_month > 0 ? `$${formatCount(sub.plan.price_usd_month)} a month` : "Free";
  return (
    <Card aria-labelledby="subscription-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="subscription-heading">Subscription</CardTitle>
      </CardHeader>
      <dl className="px-6 py-1">
        <Row term="Plan">
          {sub.plan.name}, {price}
          {sub.comped_until ? <span className="text-ink-muted"> (comped, nothing charged)</span> : null}
        </Row>
        <Row term="Status">
          <span className="flex flex-wrap items-center gap-2">
            <StateBadge state={sub.state} />
            <span className="text-sm text-ink-muted">
              {sub.active ? "Answering" : "Escalate-only: every message goes to the team"}
            </span>
          </span>
        </Row>
        <Row term="Billed through">
          {sub.provider === "stripe" ? "Stripe" : "Docent (manual, no Stripe subscription)"}
          <span className="font-mono text-sm text-ink-muted"> {sub.status}</span>
        </Row>
        {sub.trial_ends_at && sub.status === "trialing" ? (
          <Row term="Trial ends">{formatDateTime(sub.trial_ends_at)}</Row>
        ) : null}
        {sub.comped_until ? <Row term="Comped until">{formatDateTime(sub.comped_until)}</Row> : null}
        {sub.current_period_end ? (
          <Row term="Billing period">
            {sub.current_period_start ? `${formatDate(sub.current_period_start)} to ` : "Until "}
            {formatDate(sub.current_period_end)}
          </Row>
        ) : null}
        {sub.cancel_at_period_end || sub.cancel_at ? (
          <Row term="Canceled">
            {sub.cancel_at_period_end
              ? "Ends when the paid period ends"
              : `Ended or ends on ${formatDate(sub.cancel_at!)}`}
          </Row>
        ) : null}
        {sub.scheduled_plan ? (
          <Row term="Scheduled change">
            Switches to {sub.scheduled_plan.name}
            {sub.scheduled_change_at ? ` on ${formatDate(sub.scheduled_change_at)}` : " at renewal"}
          </Row>
        ) : null}
        {sub.grace_ends_at ? <Row term="Payment grace">Answers until {formatDateTime(sub.grace_ends_at)}</Row> : null}
        <Row term="Refund">{refundState(sub)}</Row>
        {sub.customer_id || sub.subscription_id ? (
          <Row term="Stripe ids">
            <span className="flex flex-col font-mono text-sm break-all">
              {sub.customer_id ? <span>{sub.customer_id}</span> : null}
              {sub.subscription_id ? <span>{sub.subscription_id}</span> : null}
            </span>
          </Row>
        ) : null}
      </dl>
    </Card>
  );
}

function refundState(sub: AdminSubscription) {
  if (sub.refunded_at) return `Refunded on ${formatDate(sub.refunded_at)}`;
  if (!sub.first_paid_at) return "No payment yet";
  if (sub.refund_until) return `First paid ${formatDate(sub.first_paid_at)}. Money-back window open until ${formatDate(sub.refund_until)}.`;
  return `First paid ${formatDate(sub.first_paid_at)}. The money-back window has closed.`;
}

function ActionsCard({ ws, onStart }: { ws: AdminWorkspace; onStart: (kind: ActionKind) => void }) {
  const { actions } = ws;
  return (
    <Card aria-labelledby="actions-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="actions-heading">Actions</CardTitle>
        <CardDescription>Each one asks for a reason and goes in this workspace&apos;s audit log with your name.</CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        {actions.refusal ? <FormAlert tone="info">{actions.refusal}</FormAlert> : null}
        <Action
          title="Extend the trial"
          detail={
            actions.extend_trial || actions.refusal
              ? "Add 1 to 30 days. A trial that has ended restarts from today."
              : "Only a workspace on a trial has one to extend."
          }
        >
          <Button variant="secondary" size="sm" disabled={!actions.extend_trial} onClick={() => onStart("trial")}>
            Extend trial
          </Button>
        </Action>
        <Action title="Give a comped plan" detail="A paid plan at no charge until a day you choose. Stripe is not involved.">
          <Button variant="secondary" size="sm" disabled={!actions.give_comp} onClick={() => onStart("comp")}>
            Give comped plan
          </Button>
        </Action>
        <Action
          title="End the comped plan"
          detail={
            actions.end_comp
              ? "Ends it now. Every message goes to the team until an owner chooses a plan."
              : "There is no comped plan to end."
          }
        >
          <Button variant="danger" size="sm" disabled={!actions.end_comp} onClick={() => onStart("end")}>
            End comped plan
          </Button>
        </Action>
      </CardBody>
    </Card>
  );
}

function Action({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line pb-5 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{detail}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function UsageCard({ usage }: { usage: AdminUsageMonth[] }) {
  const latest = usage.at(-1)?.month;
  return (
    <Card aria-labelledby="usage-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="usage-heading">Usage, last 6 months</CardTitle>
        <CardDescription>Replies as the cap counts them, and the model cost behind them.</CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-base">
          <thead>
            <tr className="border-b border-line text-sm text-ink-muted">
              <th scope="col" className="py-2.5 pr-3 pl-4 font-medium sm:pl-6">
                Month
              </th>
              <th scope="col" className="w-2/5 px-3 py-2.5 font-medium">
                Replies used
              </th>
              <th scope="col" className="py-2.5 pr-4 pl-3 text-right font-medium whitespace-nowrap sm:pr-3">
                Model cost
              </th>
              <th scope="col" className="hidden px-6 py-2.5 text-right font-medium whitespace-nowrap sm:table-cell">
                Tokens in, out
              </th>
            </tr>
          </thead>
          <tbody>
            {[...usage].reverse().map((m) => (
              <tr key={m.month} className="border-b border-line last:border-b-0">
                <th scope="row" className="py-3 pr-3 pl-4 font-normal whitespace-nowrap text-ink sm:pl-6">
                  {monthFormat.format(new Date(m.month))}
                  {m.month === latest ? <span className="text-sm text-ink-muted"> so far</span> : null}
                </th>
                <td className="px-3 py-3">
                  <div className="flex min-w-24 flex-col gap-1.5">
                    <span className="tabular-nums">
                      {formatCount(m.replies_used)}
                      <span className="text-sm text-ink-muted">
                        {m.replies_cap ? ` of ${formatCount(m.replies_cap)}` : ""}
                      </span>
                    </span>
                    {m.replies_cap ? (
                      <ProgressBar
                        value={m.replies_used}
                        max={m.replies_cap}
                        label={`Replies used in ${monthFormat.format(new Date(m.month))}`}
                        warn={m.replies_used >= m.replies_cap * 0.8}
                      />
                    ) : null}
                  </div>
                </td>
                <td className="py-3 pr-4 pl-3 text-right tabular-nums sm:pr-3">{formatMicros(m.cost_micros)}</td>
                <td className="hidden px-6 py-3 text-right whitespace-nowrap text-ink-muted tabular-nums sm:table-cell">
                  {formatCount(m.tokens_in)}, {formatCount(m.tokens_out)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function KnowledgeCard({ ws }: { ws: AdminWorkspace }) {
  const k = ws.knowledge;
  return (
    <Card aria-labelledby="knowledge-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="knowledge-heading">Knowledge</CardTitle>
        <CardDescription>Counts only, never the content.</CardDescription>
      </CardHeader>
      <dl className="px-6 py-1">
        <Row term="Sources">
          {formatCount(k.sources)}
          {k.failed_sources > 0 ? <span className="text-sm text-rust"> ({formatCount(k.failed_sources)} failed)</span> : null}
        </Row>
        <Row term="Team answers">{formatCount(k.team_answers)}</Row>
        <Row term="Pages of docs">
          {formatCount(k.documents)}
          <span className="text-sm text-ink-muted"> of {formatCount(k.documents_cap)}</span>
        </Row>
        <Row term="Passages">{formatCount(k.passages)}</Row>
      </dl>
    </Card>
  );
}

function MembersCard({ members }: { members: AdminMember[] }) {
  const now = useNow();
  return (
    <Card aria-labelledby="members-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="members-heading">Members</CardTitle>
        <CardDescription>
          {formatCount(members.length)} {plural(members.length, "person", "people")} in this workspace.
        </CardDescription>
      </CardHeader>
      <ul>
        {members.map((m) => (
          <li
            key={m.user_id}
            className="flex flex-col gap-2 border-b border-line px-6 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-ink">{m.name}</span>
                <RoleBadge role={m.role} />
              </span>
              <span className="truncate text-sm text-ink-muted">
                {m.email}
                {m.email_verified ? "" : ", not verified"}
              </span>
            </div>
            <div className="flex shrink-0 flex-col text-sm text-ink-muted sm:items-end">
              <span>Joined {formatDate(m.joined_at)}</span>
              <span>{m.last_active_at ? `Active ${formatRelative(m.last_active_at, now)}` : "Never signed in"}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WidgetsCard({ widgets }: { widgets: AdminWidget[] }) {
  return (
    <Card aria-labelledby="widgets-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="widgets-heading">Widgets</CardTitle>
      </CardHeader>
      {widgets.length === 0 ? (
        <p className="px-6 py-5 text-base text-ink-muted">No widget yet.</p>
      ) : (
        <ul>
          {widgets.map((w) => (
            <li key={w.id} className="flex flex-col gap-1 border-b border-line px-6 py-3.5 last:border-b-0">
              <span className="truncate font-medium text-ink">{w.name}</span>
              <span className="font-mono text-sm text-ink-muted">{w.public_id}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                <span className="inline-flex items-center gap-1">
                  {w.anonymous_enabled ? (
                    <CheckIcon aria-hidden="true" className="size-3.5 text-ink" weight="bold" />
                  ) : (
                    <MinusIcon aria-hidden="true" className="size-3.5" weight="bold" />
                  )}
                  Anonymous {w.anonymous_enabled ? "on" : "off"}
                </span>
                <span>
                  {formatCount(w.allowed_origins)} allowed {plural(w.allowed_origins, "origin")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BillingEventsCard({ events }: { events: AdminBillingEvent[] }) {
  return (
    <Card aria-labelledby="events-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="events-heading">Recent billing events</CardTitle>
        <CardDescription>Stripe webhooks for this workspace, newest first.</CardDescription>
      </CardHeader>
      {events.length === 0 ? (
        <p className="px-6 py-5 text-base text-ink-muted">No Stripe events for this workspace.</p>
      ) : (
        <ul>
          {events.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-1.5 border-b border-line px-6 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-sm text-ink">{e.type}</span>
                <span className="truncate font-mono text-xs text-ink-muted">{e.id}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm text-ink-muted">
                <OutcomeBadge outcome={e.outcome} />
                <span>{formatDateTime(e.received_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const auditLabels: Record<string, string> = {
  "platform_admin.workspace_viewed": "Opened in the admin console",
  "platform_admin.trial_extended": "Trial extended",
  "platform_admin.plan_comped": "Comped plan given",
  "platform_admin.comp_ended": "Comped plan ended",
  "platform_admin.job_retried": "Dead job retried",
};

function AuditCard({ entries }: { entries: AdminAuditEntry[] }) {
  const now = useNow();
  return (
    <Card aria-labelledby="audit-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="audit-heading">Recent audit entries</CardTitle>
        <CardDescription>The last 20 changes in this workspace, by its team and by the console.</CardDescription>
      </CardHeader>
      {entries.length === 0 ? (
        <p className="px-6 py-5 text-base text-ink-muted">Nothing recorded yet.</p>
      ) : (
        <ul>
          {entries.map((e) => {
            const fromConsole = e.action.startsWith("platform_admin.");
            const details = Object.entries(e.metadata).filter(([key]) => key !== "by");
            return (
              <li key={e.id} className="flex flex-col gap-1.5 border-b border-line px-6 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{auditLabels[e.action] ?? e.action}</span>
                    {fromConsole ? <Badge tone="accent">Console</Badge> : null}
                  </span>
                  <time dateTime={e.created_at} title={formatDateTime(e.created_at)} className="text-sm text-ink-muted">
                    {formatRelative(e.created_at, now)}
                  </time>
                </div>
                <p className="text-sm text-ink-muted">
                  {e.actor_name ? `${e.actor_name} (${e.actor_email})` : "No person recorded"}
                  {auditLabels[e.action] ? <span className="font-mono text-xs"> {e.action}</span> : null}
                </p>
                {details.length > 0 ? (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {details.map(([key, value]) => (
                      <div key={key} className={cn("flex min-w-0 gap-1.5", key === "reason" && "basis-full")}>
                        <dt className="text-ink-muted">{key.replaceAll("_", " ")}</dt>
                        <dd className="min-w-0 break-words text-ink">{metadataValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** An audit detail as text: lists joined, an empty one said plainly. */
function metadataValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  if (value === null || value === "") return "none";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
