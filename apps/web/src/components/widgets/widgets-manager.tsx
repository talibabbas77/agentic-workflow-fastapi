"use client";

import type { Widget } from "@docent/api-client";
import { CodeIcon, PlusIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { WidgetIllustration } from "@/components/illustrations/illustrations";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatCount, plural } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { OriginsField, readOrigins, toOriginRows } from "./origins-field";
import { widgetMode } from "./widget-mode";

export function WidgetsManager({ widgets, canManage }: { widgets: Widget[]; canManage: boolean }) {
  const [creating, setCreating] = useState(false);
  // A new key per opening gives the dialog fresh state each time.
  const [dialogKey, setDialogKey] = useState(0);

  const createButton = canManage ? (
    <Button
      onClick={() => {
        setDialogKey((n) => n + 1);
        setCreating(true);
      }}
      icon={<PlusIcon aria-hidden="true" className="size-4" />}
    >
      Create widget
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Widgets"
        description="The chat window on your site. Each widget has its own allowed sites, signing keys, and install snippet."
        actions={widgets.length > 0 ? createButton : null}
      />

      {widgets.length === 0 ? (
        <EmptyState
          illustration={<WidgetIllustration />}
          title="No widgets yet"
          action={createButton ?? <p className="text-base text-ink-muted">Owners and admins create widgets.</p>}
        >
          <p>
            Create a widget, list the sites it may appear on, and paste one script tag. To let it know who is asking,
            your server signs a short-lived token for each signed-in customer.
          </p>
        </EmptyState>
      ) : (
        <Card aria-label="Widgets">
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-base max-md:block">
              <thead className="max-md:hidden">
                <tr className="border-b border-line text-sm text-ink-muted">
                  <th scope="col" className="px-6 py-2.5 font-medium">
                    Widget
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Sites
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Who can chat
                  </th>
                  <th scope="col" className="px-6 py-2.5 text-right font-medium">
                    Signing keys
                  </th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {widgets.map((widget) => {
                  const active = widget.keys.filter((key) => key.status === "active").length;
                  const sites = widget.allowed_origins.length;
                  return (
                    <tr
                      key={widget.id}
                      className="border-b border-line align-top transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-4 max-md:gap-y-2 max-md:py-4 max-md:pr-6 max-md:pl-[4.25rem]"
                    >
                      <td className="px-6 py-3.5 max-md:-ml-11 max-md:w-[calc(100%+2.75rem)] max-md:p-0">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-paper">
                            <CodeIcon aria-hidden="true" className="size-4 text-ink-muted" />
                          </span>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <Link
                              href={`/app/widgets/${widget.id}`}
                              className="truncate rounded-sm font-medium text-ink underline-offset-[3px] hover:underline"
                            >
                              {widget.name}
                            </Link>
                            <span className="truncate font-mono text-sm text-ink-muted">{widget.public_id}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 whitespace-nowrap text-ink-muted tabular-nums max-md:p-0 max-md:text-sm">
                        {sites === 0 ? "None yet" : `${formatCount(sites)} ${plural(sites, "site")}`}
                      </td>
                      <td className="px-3 py-3.5 text-ink max-md:p-0 max-md:text-sm">
                        {widgetMode(widget.anonymous_enabled, active)}
                      </td>
                      <td className="px-6 py-3.5 text-right whitespace-nowrap text-ink-muted tabular-nums max-md:p-0 max-md:text-sm">
                        {active === 0 ? "None active" : `${active} active`}
                        <span className="md:hidden"> {plural(active, "key")}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canManage ? (
        <CreateWidgetDialog key={dialogKey} open={creating} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

function CreateWidgetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const form = useApiForm();
  const [origins, setOrigins] = useState(() => toOriginRows([]));
  const [anonymous, setAnonymous] = useState(true);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!form.check({ name: !name && "Name the widget, for example after the site it goes on." })) return;
    await form.run(
      () =>
        request(
          api.POST("/v1/widgets", {
            body: {
              name,
              allowed_origins: readOrigins(origins),
              anonymous_enabled: anonymous,
              anonymous_daily_cap: 200,
              allowed_claims: [],
              greeting: "",
              suggestions: [],
            },
          }),
        ),
      (widget) => {
        // Close first: the list stays mounted while hidden, and an open modal would leave the next page inert.
        onClose();
        toast({ tone: "success", title: "Widget created", description: "Add a signing key and install it next." });
        router.push(`/app/widgets/${widget.id}`);
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a widget"
      description="You can change all of this later, and add signing keys on the next page."
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {form.formError && form.error?.code !== "invalid_origin" ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field label="Name" error={form.fieldError("name")} hint="Shown at the top of the chat window.">
            <Input name="name" maxLength={80} autoComplete="off" placeholder="Help center" autoFocus />
          </Field>
          <OriginsField rows={origins} onChange={setOrigins} error={form.fieldError("allowed_origins")} />
          <Switch
            checked={anonymous}
            onChange={setAnonymous}
            label="Anonymous visitors"
            hint="Let people who are not signed in ask questions. They only get answers from sources for everyone."
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            Create widget
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
