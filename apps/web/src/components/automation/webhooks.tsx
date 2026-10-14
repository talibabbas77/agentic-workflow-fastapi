"use client";

import type { Webhook, WebhookDelivery, WebhookEvent } from "@docent/api-client";
import {
  ArrowClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  DotsThreeIcon,
  KeyIcon,
  ListMagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CopyButton } from "@/components/marketing/copy-button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/ui/popover-menu";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";
import { usePoll } from "@/lib/use-poll";

const events: { value: WebhookEvent; label: string; hint: string }[] = [
  { value: "escalation.created", label: "New handoff", hint: "After routing, with the ticket type and summary" },
  { value: "escalation.updated", label: "Handoff changed", hint: "Status, assignee, priority, ticket type, details, a reply" },
  { value: "escalation.resolved", label: "Handoff resolved", hint: "When someone resolves it" },
];

function DeliveryLine({ delivery }: { delivery: WebhookDelivery | null }) {
  const now = useNow();
  if (!delivery) return <span className="text-ink-muted">Nothing sent yet</span>;
  const what = delivery.test ? "Test event" : delivery.event_type;
  if (delivery.status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-muted">
        <CheckIcon aria-hidden="true" className="size-3.5 text-ink" weight="bold" />
        {what} delivered {formatRelative(delivery.delivered_at ?? delivery.created_at, now)}
        {delivery.response_status ? `, HTTP ${delivery.response_status}` : null}
      </span>
    );
  }
  if (delivery.status === "queued") {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-muted" role="status">
        <span className="spinner text-xs" aria-hidden="true" />
        {what} sending
      </span>
    );
  }
  const dead = delivery.status === "dead";
  return (
    <span className={cn("inline-flex items-start gap-1.5", dead ? "text-rust" : "text-ink-muted")}>
      <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
      <span className="break-words">
        {what} {dead ? `failed after ${delivery.attempts} ${delivery.attempts === 1 ? "try" : "tries"}` : "failed, trying again"}
        {delivery.last_error ? `: ${delivery.last_error}` : null}
      </span>
    </span>
  );
}

export function WebhooksCard({
  webhooks,
  onWebhooks,
  canManage,
}: {
  webhooks: Webhook[];
  onWebhooks: (webhooks: Webhook[]) => void;
  canManage: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [log, setLog] = useState<Webhook | null>(null);
  const [secret, setSecret] = useState<{ webhook: Webhook; secret: string; rotated: boolean } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await request(api.GET("/v1/automation/webhooks"));
    if (result.ok) onWebhooks(result.data);
  }, [onWebhooks]);
  usePoll(
    webhooks.some((w) => w.last_delivery?.status === "queued" || w.last_delivery?.status === "retrying"),
    refresh,
    2500,
  );

  function openDialog(webhook: Webhook | null) {
    setEditing(webhook);
    setDialogKey((n) => n + 1);
    setOpen(true);
  }

  async function test(webhook: Webhook) {
    setTesting(webhook.id);
    const result = await request(
      api.POST("/v1/automation/webhooks/{webhook_id}/test", { params: { path: { webhook_id: webhook.id } } }),
    );
    setTesting(null);
    if (!result.ok) {
      toast({ tone: "error", title: "Could not send a test event", description: result.error.message });
      return;
    }
    toast({ tone: "success", title: "Test event on its way" });
    await refresh();
  }

  async function rotate(webhook: Webhook) {
    const result = await request(
      api.POST("/v1/automation/webhooks/{webhook_id}/secret", { params: { path: { webhook_id: webhook.id } } }),
    );
    if (!result.ok) {
      toast({ tone: "error", title: "Could not make a new secret", description: result.error.message });
      return;
    }
    setSecret({ webhook, secret: result.data.secret, rotated: true });
    await refresh();
  }

  return (
    <Card aria-labelledby="webhooks-heading">
      <CardHeader className="sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1">
          <CardTitle id="webhooks-heading">Webhooks</CardTitle>
          <CardDescription>
            Send handoff events to n8n, Zapier, Make, or your own server. Each request is signed, retried for about an
            hour when it fails, and listed in the delivery log.
          </CardDescription>
        </div>
        {canManage ? (
          <Button
            variant="secondary"
            className="shrink-0 self-start sm:self-auto"
            onClick={() => openDialog(null)}
            icon={<PlusIcon aria-hidden="true" className="size-4" />}
          >
            Add webhook
          </Button>
        ) : null}
      </CardHeader>
      {webhooks.length === 0 ? (
        <p className="px-6 py-6 text-base text-ink-muted">No webhooks yet.</p>
      ) : (
        <ul aria-label="Webhooks">
          {webhooks.map((webhook) => (
            <li
              key={webhook.id}
              className="flex flex-col gap-3 border-b border-line px-6 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 gap-3">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-muted">
                  <WebhooksLogoIcon aria-hidden="true" className="size-4.5" />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all text-ink">{webhook.description || webhook.url_hint}</span>
                    {webhook.active ? null : (
                      <span className="rounded-sm border border-line-strong px-1.5 text-xs text-ink-muted">Off</span>
                    )}
                  </p>
                  {webhook.description ? (
                    <p className="font-mono text-sm break-all text-ink-muted">{webhook.url_hint}</p>
                  ) : null}
                  <p className="text-sm text-ink-muted">
                    {webhook.events.length === 0
                      ? "Only handoffs a rule sends here"
                      : events
                          .filter((e) => webhook.events.includes(e.value))
                          .map((e) => e.label)
                          .join(", ")}
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono">{webhook.secret_hint}</span>
                  </p>
                  <p className="text-sm">
                    <DeliveryLine delivery={webhook.last_delivery} />
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1 self-end sm:self-start">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ListMagnifyingGlassIcon aria-hidden="true" className="size-4" />}
                  onClick={() => setLog(webhook)}
                >
                  Deliveries
                </Button>
                {canManage ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={testing === webhook.id}
                      icon={<PaperPlaneTiltIcon aria-hidden="true" className="size-4" />}
                      onClick={() => void test(webhook)}
                    >
                      Send test event
                    </Button>
                    <PopoverMenu
                      label={`Actions for webhook ${webhook.url_hint}`}
                      align="end"
                      className="w-48"
                      trigger={(props) => (
                        <Button variant="ghost" size="icon" {...props} aria-label={`Actions for webhook ${webhook.url_hint}`}>
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
                              openDialog(webhook);
                            }}
                          >
                            Edit
                          </MenuItem>
                          <MenuItem
                            icon={<KeyIcon aria-hidden="true" className="size-4 text-ink-muted" />}
                            onClick={() => {
                              close();
                              void rotate(webhook);
                            }}
                          >
                            New signing secret
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem
                            className="text-rust"
                            icon={<TrashIcon aria-hidden="true" className="size-4" />}
                            onClick={() => {
                              close();
                              setDeleting(webhook);
                            }}
                          >
                            Delete
                          </MenuItem>
                        </>
                      )}
                    </PopoverMenu>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <PayloadDocs />
      <DeliveriesDialog
        key={log?.id ?? "closed"}
        webhook={log}
        canManage={canManage}
        onClose={() => setLog(null)}
        onChanged={refresh}
      />
      {canManage ? (
        <>
          <WebhookDialog
            key={dialogKey}
            open={open}
            editing={editing}
            onClose={() => setOpen(false)}
            onCreated={(webhook, value) => {
              setOpen(false);
              onWebhooks([...webhooks, webhook]);
              setSecret({ webhook, secret: value, rotated: false });
            }}
            onSaved={(webhook) => {
              setOpen(false);
              onWebhooks(webhooks.map((w) => (w.id === webhook.id ? webhook : w)));
              toast({ tone: "success", title: "Webhook saved" });
            }}
          />
          <SecretDialog shown={secret} onClose={() => setSecret(null)} />
          <DeleteWebhook
            target={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={(webhook) => {
              setDeleting(null);
              onWebhooks(webhooks.filter((w) => w.id !== webhook.id));
              toast({ tone: "success", title: "Webhook deleted" });
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

function WebhookDialog({
  open,
  editing,
  onClose,
  onCreated,
  onSaved,
}: {
  open: boolean;
  editing: Webhook | null;
  onClose: () => void;
  onCreated: (webhook: Webhook, secret: string) => void;
  onSaved: (webhook: Webhook) => void;
}) {
  const form = useApiForm();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [chosen, setChosen] = useState<WebhookEvent[]>(editing?.events ?? events.map((e) => e.value));
  const [active, setActive] = useState(editing?.active ?? true);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.check({ url: !editing && !url.trim() && "Paste the URL that receives the events." })) return;
    if (editing) {
      await form.run(
        () =>
          request(
            api.PATCH("/v1/automation/webhooks/{webhook_id}", {
              params: { path: { webhook_id: editing.id } },
              body: { url: url.trim() || null, description: description.trim(), events: chosen, active },
            }),
          ),
        onSaved,
      );
    } else {
      await form.run(
        () =>
          request(
            api.POST("/v1/automation/webhooks", {
              body: { url: url.trim(), description: description.trim(), events: chosen, active },
            }),
          ),
        (data) => onCreated(data.webhook, data.secret),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? "Edit webhook" : "Add a webhook"}
      description="Docent sends a signed POST with a JSON body for each event you choose."
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {form.formError && !form.fieldError("url") ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field
            label="URL"
            error={form.fieldError("url")}
            hint={editing ? `Now ${editing.url_hint}. Leave empty to keep it.` : "Stored encrypted, since such URLs often work as passwords."}
          >
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={2048}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
              autoFocus
            />
          </Field>
          <Field label="Description" error={form.fieldError("description")} hint="Optional. Shown instead of the URL.">
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={200}
              placeholder="n8n ticket sync"
            />
          </Field>
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-1.5 text-sm font-medium text-ink">Events</legend>
            {events.map((e) => (
              <label key={e.value} className="flex items-start gap-2.5 text-base text-ink">
                <input
                  type="checkbox"
                  checked={chosen.includes(e.value)}
                  onChange={(event) =>
                    setChosen((list) =>
                      event.target.checked ? [...list, e.value] : list.filter((v) => v !== e.value),
                    )
                  }
                  className="mt-1 size-4 accent-rust"
                />
                <span className="flex flex-col">
                  <span>
                    {e.label} <span className="font-mono text-sm text-ink-muted">{e.value}</span>
                  </span>
                  <span className="text-sm text-ink-muted">{e.hint}</span>
                </span>
              </label>
            ))}
            <p className="text-sm text-ink-muted">With none chosen, only routing rules send to this webhook.</p>
          </fieldset>
          <Switch checked={active} onChange={setActive} label="Active" />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            {editing ? "Save webhook" : "Add webhook"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** The signing secret, shown once, right after it is made. */
function SecretDialog({
  shown,
  onClose,
}: {
  shown: { webhook: Webhook; secret: string; rotated: boolean } | null;
  onClose: () => void;
}) {
  const [last, setLast] = useState(shown);
  if (shown && shown !== last) setLast(shown);
  const current = shown ?? last;
  return (
    <Dialog
      open={shown !== null}
      onClose={onClose}
      title={current?.rotated ? "Your new signing secret" : "Webhook added"}
      description="Copy the signing secret now. Docent stores it encrypted and never shows it again."
    >
      <DialogBody className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2.5">
          <code className="min-w-0 font-mono text-sm break-all text-ink">{current?.secret}</code>
          {current ? <CopyButton text={current.secret} label="Signing secret" /> : null}
        </div>
        <p className="text-sm text-ink-muted">
          Use it to check the <span className="font-mono">Docent-Signature</span> header on each request.
          {current?.rotated ? " The old secret stopped working." : null}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>I saved it</Button>
      </DialogFooter>
    </Dialog>
  );
}

function DeliveriesDialog({
  webhook,
  canManage,
  onClose,
  onChanged,
}: {
  webhook: Webhook | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const now = useNow();
  const toast = useToast();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const id = webhook?.id ?? null;

  const load = useCallback(async () => {
    if (!id) return;
    const result = await request(
      api.GET("/v1/automation/webhooks/{webhook_id}/deliveries", { params: { path: { webhook_id: id } } }),
    );
    if (result.ok) setDeliveries(result.data);
  }, [id]);

  // The first load; polling keeps it current while the dialog is open.
  useEffect(() => {
    if (!id) return;
    let live = true;
    void request(
      api.GET("/v1/automation/webhooks/{webhook_id}/deliveries", { params: { path: { webhook_id: id } } }),
    ).then((result) => {
      if (live && result.ok) setDeliveries(result.data);
    });
    return () => {
      live = false;
    };
  }, [id]);
  usePoll(id !== null, load, 3000);

  async function retry(delivery: WebhookDelivery) {
    if (!id) return;
    const result = await request(
      api.POST("/v1/automation/webhooks/{webhook_id}/deliveries/{delivery_id}/retry", {
        params: { path: { webhook_id: id, delivery_id: delivery.id } },
      }),
    );
    if (!result.ok) toast({ tone: "error", title: "Could not send it again", description: result.error.message });
    await load();
    await onChanged();
  }

  return (
    <Dialog
      open={webhook !== null}
      onClose={onClose}
      size="lg"
      title="Delivery log"
      description={webhook ? `The latest 50 events sent to ${webhook.description || webhook.url_hint}.` : undefined}
    >
      <DialogBody>
        {deliveries === null ? (
          <p className="flex items-center gap-2 text-base text-ink-muted" role="status">
            <span className="spinner text-xs" aria-hidden="true" />
            Loading deliveries
          </p>
        ) : deliveries.length === 0 ? (
          <p className="text-base text-ink-muted">Nothing sent yet. Send a test event to try it.</p>
        ) : (
          <ul aria-label="Deliveries" className="flex max-h-[60vh] flex-col overflow-y-auto rounded-md border border-line">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-col gap-1.5 border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-ink">{d.event_type}</span>
                    {d.test ? (
                      <span className="rounded-sm border border-line-strong px-1.5 text-xs text-ink-muted">Test</span>
                    ) : null}
                    <span className="text-ink-muted">{formatRelative(d.created_at, now)}</span>
                  </p>
                  <span
                    className={cn(
                      "rounded-sm px-1.5 text-xs font-medium",
                      d.status === "dead"
                        ? "bg-rust text-on-rust"
                        : d.status === "succeeded"
                          ? "bg-surface-2 text-ink"
                          : "border border-line-strong text-ink-muted",
                    )}
                  >
                    {d.status === "succeeded"
                      ? "Delivered"
                      : d.status === "dead"
                        ? "Failed"
                        : d.status === "retrying"
                          ? "Retrying"
                          : "Sending"}
                  </span>
                </div>
                <p className="text-sm text-ink-muted tabular-nums">
                  {d.attempts} of {d.max_attempts} {d.max_attempts === 1 ? "try" : "tries"}
                  {d.response_status ? `, HTTP ${d.response_status}` : null}
                  {d.response_ms !== null && d.response_ms !== undefined ? `, ${d.response_ms} ms` : null}
                  {d.next_attempt_at ? `, next try ${formatRelative(d.next_attempt_at, now).replace(" ago", "")}` : null}
                </p>
                {d.last_error ? (
                  <p className="flex items-start gap-1.5 text-sm break-words text-rust">
                    <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
                    {d.last_error}
                  </p>
                ) : null}
                <p className="font-mono text-xs break-all text-ink-subtle">{d.event_id}</p>
                {canManage && d.status === "dead" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    icon={<ArrowClockwiseIcon aria-hidden="true" className="size-4" />}
                    onClick={() => void retry(d)}
                  >
                    Send again
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function DeleteWebhook({
  target,
  onClose,
  onDeleted,
}: {
  target: Webhook | null;
  onClose: () => void;
  onDeleted: (webhook: Webhook) => void;
}) {
  const form = useApiForm();
  const [last, setLast] = useState(target);
  if (target && target !== last) setLast(target);
  const shown = target ?? last;
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title="Delete this webhook?"
      description="Docent stops sending events to it and deletes its delivery log."
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
              () =>
                request(api.DELETE("/v1/automation/webhooks/{webhook_id}", { params: { path: { webhook_id: shown.id } } })),
              () => onDeleted(shown),
            );
          }}
        >
          Delete webhook
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

const PAYLOAD = `{
  "id": "evt_0192f1c4a8b07e2c9d3b5a6f7e8d9c0b",
  "type": "escalation.created",
  "created_at": "2026-10-14T09:30:00Z",
  "test": false,
  "workspace": { "id": "0192...", "name": "Lumen Notes" },
  "data": {
    "escalation": {
      "id": "0192...",
      "url": "https://app.example.com/app/inbox/0192...",
      "status": "open",
      "reason": "user_requested",
      "priority": "high",
      "issue": "Charged twice for the March invoice",
      "ticket_type": { "id": "0192...", "name": "Billing" },
      "fields": { "invoice_number": "INV-1042" },
      "summary": { "issue": "...", "tried": "...", "user_context": "...",
                   "sentiment": "calm", "suggested_next_step": "..." },
      "contact_email": "customer@example.com",
      "assignee": { "id": "0192...", "name": "Ana Lima", "email": "ana@example.com" },
      "customer": { "external_id": "user_123", "name": "Ana Souza", "email": "ana@example.com" },
      "created_at": "...", "updated_at": "...",
      "first_response_at": null, "resolved_at": null
    }
  }
}`;

const VERIFY = `import crypto from "node:crypto";

// header: the Docent-Signature value, body: the raw request body as a string
export function verify(secret, header, body) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!parts.t || age > 300) return false; // older than five minutes
  const expected = crypto.createHmac("sha256", secret).update(\`\${parts.t}.\${body}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""));
}`;

function PayloadDocs() {
  return (
    <details className="group border-t border-line">
      <summary className="flex items-center gap-2 px-6 py-3.5 text-base font-medium text-ink select-none hover:bg-surface-2/60">
        <CaretRightIcon
          aria-hidden="true"
          className="size-3.5 text-ink-muted transition-transform duration-150 group-open:rotate-90"
          weight="bold"
        />
        Payload and signature
      </summary>
      <div className="flex flex-col gap-4 px-6 pb-6 text-base text-ink-muted">
        <p>
          Each event is a POST with a JSON body. <span className="font-mono text-ink">escalation.updated</span> adds{" "}
          <span className="font-mono text-ink">data.changes</span>, such as{" "}
          <span className="font-mono text-ink">[&quot;status&quot;, &quot;assignee&quot;]</span>. Test events have{" "}
          <span className="font-mono text-ink">&quot;test&quot;: true</span> and sample data. The transcript is never
          sent.
        </p>
        <pre className="overflow-x-auto rounded-md border border-line bg-paper p-4 font-mono text-xs leading-relaxed text-ink">
          {PAYLOAD}
        </pre>
        <p>
          The <span className="font-mono text-ink">Docent-Signature</span> header reads{" "}
          <span className="font-mono text-ink">t=1760434200,v1=5257a8...</span>. v1 is the HMAC-SHA256 of the timestamp,
          a dot, and the raw body, keyed with your signing secret. Reject requests older than five minutes. A delivery
          that fails is tried again after 30 seconds, 2 minutes, 10 minutes, and an hour, with the same event id, so
          skip ids you have seen.
        </p>
        <pre className="overflow-x-auto rounded-md border border-line bg-paper p-4 font-mono text-xs leading-relaxed text-ink">
          {VERIFY}
        </pre>
      </div>
    </details>
  );
}
