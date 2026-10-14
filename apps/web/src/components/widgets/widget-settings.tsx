"use client";

import type { Widget } from "@docent/api-client";
import { useState, type FormEvent } from "react";
import { CLAIM_KEY } from "@/components/agent/claims-editor";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChipField } from "@/components/ui/chip-field";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { useApiForm } from "@/lib/use-api-form";
import { OriginsField, readOrigins, toOriginRows } from "./origins-field";

const MAX_CAP = 100_000;

/** Name, greeting, where the widget may appear, and who may use it. Mount with a key per saved version. */
export function WidgetSettings({
  widget,
  canManage,
  onSaved,
}: {
  widget: Widget;
  canManage: boolean;
  onSaved: (widget: Widget) => void;
}) {
  const toast = useToast();
  const form = useApiForm();
  const [name, setName] = useState(widget.name);
  const [greeting, setGreeting] = useState(widget.greeting);
  const [origins, setOrigins] = useState(() => toOriginRows(widget.allowed_origins));
  const [anonymous, setAnonymous] = useState(widget.anonymous_enabled);
  const [cap, setCap] = useState(String(widget.anonymous_daily_cap));
  const [claims, setClaims] = useState(widget.allowed_claims);

  const changed =
    name.trim() !== widget.name ||
    greeting.trim() !== widget.greeting ||
    readOrigins(origins).join("\n") !== widget.allowed_origins.join("\n") ||
    anonymous !== widget.anonymous_enabled ||
    cap.trim() !== String(widget.anonymous_daily_cap) ||
    claims.join("\n") !== widget.allowed_claims.join("\n");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dailyCap = Number(cap);
    const ok = form.check({
      name: !name.trim() && "Name the widget.",
      anonymous_daily_cap:
        !(cap.trim() && Number.isInteger(dailyCap) && dailyCap >= 0 && dailyCap <= MAX_CAP) &&
        `Choose a whole number from 0 to ${MAX_CAP.toLocaleString("en-US")}.`,
    });
    if (!ok) return;
    await form.run(
      () =>
        request(
          api.PUT("/v1/widgets/{widget_id}", {
            params: { path: { widget_id: widget.id } },
            body: {
              name: name.trim(),
              greeting: greeting.trim(),
              allowed_origins: readOrigins(origins),
              anonymous_enabled: anonymous,
              anonymous_daily_cap: dailyCap,
              allowed_claims: claims,
            },
          }),
        ),
      (saved) => {
        toast({ tone: "success", title: "Widget saved", description: saved.name });
        onSaved(saved);
      },
    );
  }

  return (
    <Card aria-labelledby="widget-settings-heading">
      <CardHeader>
        <CardTitle id="widget-settings-heading">Settings</CardTitle>
        <CardDescription>
          {canManage
            ? "What visitors see, where the widget may appear, and who can use it."
            : "Only owners and admins can change these."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="flex flex-col gap-6">
          {form.formError && form.error?.code !== "invalid_origin" ? <FormAlert>{form.formError}</FormAlert> : null}
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-x-10">
            <div className="flex min-w-0 flex-col gap-6">
              <Field label="Name" error={form.fieldError("name")} hint="Shown at the top of the chat window.">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  readOnly={!canManage}
                  maxLength={80}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Greeting"
                error={form.fieldError("greeting")}
                hint="The first message visitors see. Leave it empty for none."
              >
                <Textarea
                  value={greeting}
                  onChange={(event) => setGreeting(event.target.value)}
                  readOnly={!canManage}
                  maxLength={200}
                  rows={2}
                  placeholder="Hi, ask me anything about your account."
                />
              </Field>
              <OriginsField
                rows={origins}
                onChange={setOrigins}
                error={form.fieldError("allowed_origins")}
                readOnly={!canManage}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <Switch
                checked={anonymous}
                onChange={setAnonymous}
                disabled={!canManage}
                label="Anonymous visitors"
                hint="Let people who are not signed in ask questions. They only get answers from sources for everyone."
              />
              <Field
                label="Anonymous messages per day"
                error={form.fieldError("anonymous_daily_cap")}
                hint="Shared by every anonymous visitor on this widget. Signed-in customers do not count toward it."
              >
                <Input
                  value={cap}
                  onChange={(event) => setCap(event.target.value)}
                  readOnly={!canManage}
                  disabled={!anonymous}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_CAP}
                  className="tabular-nums sm:max-w-48"
                />
              </Field>
              <ChipField
                label="Customer details the agent may see"
                values={claims}
                onChange={setClaims}
                readOnly={!canManage}
                max={20}
                maxLength={40}
                mono
                validate={(key) =>
                  CLAIM_KEY.test(key) ? null : "Use lowercase letters, digits, and underscores, starting with a letter."
                }
                placeholder="plan"
                error={form.fieldError("allowed_claims")}
                hint="Names in the ctx object of the signed token, such as plan. Docent drops any other details before the agent sees them."
              />
            </div>
          </div>
        </CardBody>
        {canManage ? (
          <CardFooter>
            <Button type="submit" loading={form.pending} disabled={!changed}>
              Save changes
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
