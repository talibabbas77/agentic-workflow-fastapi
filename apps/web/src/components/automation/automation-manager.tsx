"use client";

import type {
  Assignee,
  InboxSettings,
  NotificationPrefs,
  RoutingRule,
  SlackChannel,
  TicketType,
  Webhook,
} from "@docent/api-client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { useApiForm } from "@/lib/use-api-form";
import { RulesCard } from "./rules";
import { SlackCard } from "./slack";
import { WebhooksCard } from "./webhooks";

export type AutomationData = {
  rules: RoutingRule[];
  channels: SlackChannel[];
  webhooks: Webhook[];
  ticketTypes: TicketType[];
  assignees: Assignee[];
  settings: InboxSettings;
  prefs: NotificationPrefs;
  meEmail: string;
};

/** Where handoffs go once they arrive. Everyone can look; owners and admins change it. */
export function AutomationManager({ initial, canManage }: { initial: AutomationData; canManage: boolean }) {
  const [rules, setRules] = useState(initial.rules);
  const [channels, setChannels] = useState(initial.channels);
  const [webhooks, setWebhooks] = useState(initial.webhooks);
  const lookups = { ticketTypes: initial.ticketTypes, assignees: initial.assignees, channels, webhooks };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Automation"
        description="Decide who hears about each handoff and where it goes: routing rules, Slack, webhooks, and the address customers reply to."
      />
      {canManage ? null : (
        <FormAlert tone="info">
          Owners and admins change automation. You can still choose your own notifications at the bottom of this page.
        </FormAlert>
      )}
      <RulesCard rules={rules} onRules={setRules} lookups={lookups} canManage={canManage} />
      <SlackCard channels={channels} onChannels={setChannels} canManage={canManage} />
      <WebhooksCard webhooks={webhooks} onWebhooks={setWebhooks} canManage={canManage} />
      <div className="grid gap-8 lg:grid-cols-2">
        <RepliesCard initial={initial.settings} meEmail={initial.meEmail} canManage={canManage} />
        <PrefsCard initial={initial.prefs} />
      </div>
    </div>
  );
}

function RepliesCard({
  initial,
  meEmail,
  canManage,
}: {
  initial: InboxSettings;
  meEmail: string;
  canManage: boolean;
}) {
  const toast = useToast();
  const form = useApiForm();
  const [settings, setSettings] = useState(initial);
  const [email, setEmail] = useState(initial.support_email ?? "");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!form.check({ support_email: value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && "Enter an email address." }))
      return;
    await form.run(
      () => request(api.PATCH("/v1/inbox/settings", { body: { support_email: value || null } })),
      (saved) => {
        setSettings(saved);
        setEmail(saved.support_email ?? "");
        toast({ tone: "success", title: "Reply address saved" });
      },
    );
  }

  return (
    <Card aria-labelledby="replies-heading" className="flex flex-col">
      <CardHeader>
        <CardTitle id="replies-heading">Replies to customers</CardTitle>
        <CardDescription>
          Inbox replies go out from Docent with your workspace name. When the customer answers, it goes to this address,
          so the conversation continues in your own mailbox.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
        <CardBody className="flex flex-1 flex-col gap-4">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field
            label="Support email"
            error={form.fieldError("support_email")}
            hint={
              settings.support_email
                ? undefined
                : `Not set: answers go to whoever sent the reply, such as ${meEmail}.`
            }
          >
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              readOnly={!canManage}
              placeholder="support@yourcompany.com"
              maxLength={254}
              autoComplete="off"
            />
          </Field>
          <dl className="flex flex-col gap-1.5 rounded-md border border-line bg-paper px-3.5 py-3 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-ink-muted">From</dt>
              <dd className="min-w-0 break-all text-ink">{settings.reply_from}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-ink-muted">Reply-To</dt>
              <dd className="min-w-0 break-all text-ink">{settings.support_email ?? "The teammate who replies"}</dd>
            </div>
          </dl>
        </CardBody>
        {canManage ? (
          <CardFooter>
            <Button type="submit" loading={form.pending}>
              Save
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}

function PrefsCard({ initial }: { initial: NotificationPrefs }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save(next: NotificationPrefs) {
    const before = prefs;
    setPrefs(next);
    setSaving(true);
    const result = await request(api.PUT("/v1/inbox/preferences", { body: next }));
    setSaving(false);
    if (result.ok) {
      setPrefs(result.data);
      toast({ tone: "success", title: "Notifications saved" });
    } else {
      setPrefs(before);
      toast({ tone: "error", title: "Could not save that", description: result.error.message });
    }
  }

  return (
    <Card aria-labelledby="prefs-heading">
      <CardHeader>
        <CardTitle id="prefs-heading">Your notifications</CardTitle>
        <CardDescription>Only for you, in this workspace.</CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <Switch
          checked={prefs.daily_digest}
          disabled={saving}
          onChange={(on) => void save({ ...prefs, daily_digest: on })}
          label="Daily digest"
          hint="One email at 08:00 UTC while handoffs are open: what is new, what is yours, and what nobody has taken."
        />
        <Switch
          checked={prefs.assigned_email}
          disabled={saving}
          onChange={(on) => void save({ ...prefs, assigned_email: on })}
          label="When a handoff is assigned to me"
          hint="An email when a teammate or a rule assigns you a handoff."
        />
      </CardBody>
    </Card>
  );
}
