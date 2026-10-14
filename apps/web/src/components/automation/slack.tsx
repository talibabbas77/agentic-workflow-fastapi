"use client";

import type { NotificationState, SlackChannel } from "@docent/api-client";
import {
  CheckIcon,
  DotsThreeIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlackLogoIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
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

const kindLabel: Record<NotificationState["kind"], string> = {
  test: "Test message",
  new_handoff: "New handoff",
  assigned: "Assignment",
  daily_digest: "Digest",
};

/** The last message Docent posted to a channel, and how it went. */
export function DeliveryState({ state }: { state: NotificationState | null }) {
  const now = useNow();
  if (!state) return <span className="text-ink-muted">Nothing sent yet</span>;
  const label = kindLabel[state.kind];
  if (state.status === "sent") {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-muted">
        <CheckIcon aria-hidden="true" className="size-3.5 text-ink" weight="bold" />
        {label} posted {formatRelative(state.sent_at ?? state.created_at, now)}
      </span>
    );
  }
  if (state.status === "queued") {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-muted" role="status">
        <span className="spinner text-xs" aria-hidden="true" />
        {label} sending
      </span>
    );
  }
  if (state.status === "skipped") return <span className="text-ink-muted">{label} skipped: the channel is off</span>;
  const dead = state.status === "dead";
  return (
    <span className={cn("inline-flex items-start gap-1.5", dead ? "text-rust" : "text-ink-muted")}>
      <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
      <span>
        {label} {dead ? `failed after ${state.attempts} ${state.attempts === 1 ? "try" : "tries"}` : "failed, trying again"}
        {state.last_error ? `: ${state.last_error}` : null}
      </span>
    </span>
  );
}

export function SlackCard({
  channels,
  onChannels,
  canManage,
}: {
  channels: SlackChannel[];
  onChannels: (channels: SlackChannel[]) => void;
  canManage: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<SlackChannel | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const [deleting, setDeleting] = useState<SlackChannel | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const refresh = async () => {
    const result = await request(api.GET("/v1/automation/channels"));
    if (result.ok) onChannels(result.data);
  };
  // While a message is on its way, check on it.
  usePoll(
    channels.some((c) => c.last_delivery?.status === "queued" || c.last_delivery?.status === "retrying"),
    refresh,
    2000,
  );

  function openDialog(channel: SlackChannel | null) {
    setEditing(channel);
    setDialogKey((n) => n + 1);
    setOpen(true);
  }

  async function test(channel: SlackChannel) {
    setTesting(channel.id);
    const result = await request(
      api.POST("/v1/automation/channels/{channel_id}/test", { params: { path: { channel_id: channel.id } } }),
    );
    setTesting(null);
    if (!result.ok) {
      toast({ tone: "error", title: "Could not send a test", description: result.error.message });
      return;
    }
    toast({ tone: "success", title: "Test message on its way", description: channel.name });
    await refresh();
  }

  async function setActive(channel: SlackChannel, active: boolean) {
    const result = await request(
      api.PATCH("/v1/automation/channels/{channel_id}", {
        params: { path: { channel_id: channel.id } },
        body: { active },
      }),
    );
    if (result.ok) onChannels(channels.map((c) => (c.id === channel.id ? result.data : c)));
    else toast({ tone: "error", title: "Could not change the channel", description: result.error.message });
  }

  return (
    <Card aria-labelledby="slack-heading">
      <CardHeader className="sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1">
          <CardTitle id="slack-heading">Slack</CardTitle>
          <CardDescription>
            Post new handoffs to a Slack channel through an incoming webhook. The webhook URL is stored encrypted and is
            never shown again.
          </CardDescription>
        </div>
        {canManage ? (
          <Button
            variant="secondary"
            className="shrink-0 self-start sm:self-auto"
            onClick={() => openDialog(null)}
            icon={<PlusIcon aria-hidden="true" className="size-4" />}
          >
            Add Slack channel
          </Button>
        ) : null}
      </CardHeader>
      {channels.length === 0 ? (
        <p className="px-6 py-6 text-base text-ink-muted">
          No Slack channels. In Slack, add the Incoming Webhooks app to a channel and paste its URL here.
        </p>
      ) : (
        <ul aria-label="Slack channels">
          {channels.map((channel) => (
            <li
              key={channel.id}
              className="flex flex-col gap-3 border-b border-line px-6 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 gap-3">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-muted">
                  <SlackLogoIcon aria-hidden="true" className="size-4.5" />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{channel.name}</span>
                    {channel.active ? null : (
                      <span className="rounded-sm border border-line-strong px-1.5 text-xs text-ink-muted">Off</span>
                    )}
                  </p>
                  <p className="truncate font-mono text-sm text-ink-muted">{channel.url_hint}</p>
                  <p className="text-sm text-ink-muted">
                    {channel.post_all ? "Every new handoff" : "Only handoffs a rule sends here"}
                  </p>
                  <p className="text-sm">
                    <DeliveryState state={channel.last_delivery} />
                  </p>
                </div>
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={testing === channel.id}
                    icon={<PaperPlaneTiltIcon aria-hidden="true" className="size-4" />}
                    onClick={() => void test(channel)}
                  >
                    Send test
                  </Button>
                  <PopoverMenu
                    label={`Actions for ${channel.name}`}
                    align="end"
                    className="w-44"
                    trigger={(props) => (
                      <Button variant="ghost" size="icon" {...props} aria-label={`Actions for ${channel.name}`}>
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
                            openDialog(channel);
                          }}
                        >
                          Edit
                        </MenuItem>
                        <MenuItem
                          onClick={() => {
                            close();
                            void setActive(channel, !channel.active);
                          }}
                        >
                          {channel.active ? "Turn off" : "Turn on"}
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          className="text-rust"
                          icon={<TrashIcon aria-hidden="true" className="size-4" />}
                          onClick={() => {
                            close();
                            setDeleting(channel);
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
          ))}
        </ul>
      )}
      {canManage ? (
        <>
          <ChannelDialog
            key={dialogKey}
            open={open}
            editing={editing}
            onClose={() => setOpen(false)}
            onSaved={(saved) => {
              setOpen(false);
              onChannels(editing ? channels.map((c) => (c.id === saved.id ? saved : c)) : [...channels, saved]);
              toast({ tone: "success", title: editing ? "Channel saved" : "Channel added", description: saved.name });
            }}
          />
          <DeleteChannel
            target={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={(channel) => {
              setDeleting(null);
              onChannels(channels.filter((c) => c.id !== channel.id));
              toast({ tone: "success", title: "Channel deleted", description: channel.name });
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

function ChannelDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: SlackChannel | null;
  onClose: () => void;
  onSaved: (channel: SlackChannel) => void;
}) {
  const form = useApiForm();
  const [name, setName] = useState(editing?.name ?? "");
  const [url, setUrl] = useState("");
  const [postAll, setPostAll] = useState(editing?.post_all ?? true);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = form.check({
      name: !name.trim() && "Name the channel, such as #support.",
      url: !editing && !url.trim() && "Paste the incoming webhook URL from Slack.",
    });
    if (!ok) return;
    await form.run(
      () =>
        request(
          editing
            ? api.PATCH("/v1/automation/channels/{channel_id}", {
                params: { path: { channel_id: editing.id } },
                body: { name: name.trim(), post_all: postAll, url: url.trim() || null },
              })
            : api.POST("/v1/automation/channels", {
                body: { name: name.trim(), url: url.trim(), post_all: postAll },
              }),
        ),
      onSaved,
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "Add a Slack channel"}
      description="In Slack, add the Incoming Webhooks app to the channel, then copy its webhook URL."
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {form.formError && !form.fieldError("url") ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field label="Name" error={form.fieldError("name")}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="#support"
              autoComplete="off"
              autoFocus
            />
          </Field>
          <Field
            label="Webhook URL"
            error={form.fieldError("url")}
            hint={
              editing
                ? `Now ${editing.url_hint}. Leave empty to keep it.`
                : "Starts with https://hooks.slack.com/services/. Stored encrypted."
            }
          >
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={2048}
              placeholder="https://hooks.slack.com/services/..."
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Switch
            checked={postAll}
            onChange={setPostAll}
            label="Post every new handoff"
            hint="Off: only handoffs a routing rule sends to this channel."
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            {editing ? "Save channel" : "Add channel"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function DeleteChannel({
  target,
  onClose,
  onDeleted,
}: {
  target: SlackChannel | null;
  onClose: () => void;
  onDeleted: (channel: SlackChannel) => void;
}) {
  const form = useApiForm();
  const [last, setLast] = useState(target);
  if (target && target !== last) setLast(target);
  const shown = target ?? last;
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={`Delete ${shown?.name ?? "this channel"}?`}
      description="Docent stops posting there and forgets its URL. Rules that post to it stop doing so."
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
                request(
                  api.DELETE("/v1/automation/channels/{channel_id}", { params: { path: { channel_id: shown.id } } }),
                ),
              () => onDeleted(shown),
            );
          }}
        >
          Delete channel
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
