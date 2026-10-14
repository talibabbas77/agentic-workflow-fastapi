"use client";

import type { Tenant } from "@docent/api-client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CardBody, CardFooter } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatDate } from "@/lib/format";
import { useApiForm } from "@/lib/use-api-form";
import { useNow } from "@/lib/use-now";

/** "America/Argentina/Buenos_Aires" as "Argentina, Buenos Aires". */
function placeName(zone: string) {
  return zone.split("/").slice(1).join(", ").replaceAll("_", " ") || zone;
}

/** Zones grouped by area for the select: UTC on its own, then Africa, America, and so on. */
function groupZones(zones: string[]) {
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const area = zone.includes("/") ? zone.split("/")[0]! : "";
    groups.set(area, [...(groups.get(area) ?? []), zone]);
  }
  return [...groups];
}

const noop = () => () => {};

/** The browser's own time zone, once hydrated. */
function useBrowserZone() {
  return useSyncExternalStore(
    noop,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
}

function clock(zone: string, now: number) {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(now);
  } catch {
    return null;
  }
}

export function WorkspaceForm({ tenant, canEdit, zones }: { tenant: Tenant; canEdit: boolean; zones: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const form = useApiForm();
  const now = useNow();
  const browserZone = useBrowserZone();
  const [name, setName] = useState(tenant.name);
  const [timezone, setTimezone] = useState(tenant.timezone);
  const grouped = useMemo(() => groupZones(zones.includes(timezone) ? zones : [timezone, ...zones]), [zones, timezone]);
  const nameChanged = name.trim() !== tenant.name && name.trim().length > 0;
  const zoneChanged = timezone !== tenant.timezone;
  const localTime = now === null ? null : clock(timezone, now);
  const suggest = browserZone && browserZone !== timezone && zones.includes(browserZone) ? browserZone : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!form.check({ name: !trimmed && "Enter a workspace name." })) return;
    await form.run(
      () =>
        request(
          api.PATCH("/v1/tenant", {
            body: {
              ...(nameChanged ? { name: trimmed } : {}),
              ...(zoneChanged ? { timezone } : {}),
            },
          }),
        ),
      () => {
        toast({ tone: "success", title: "Workspace saved" });
        router.refresh();
      },
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <CardBody className="flex flex-col gap-5">
        {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
        <Field
          label="Workspace name"
          error={form.fieldError("name")}
          hint={canEdit ? "Shown to your team and in emails Docent sends." : "Only owners and admins can change this."}
        >
          <Input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            readOnly={!canEdit}
            maxLength={120}
            autoComplete="off"
          />
        </Field>
        <Field
          label="Time zone"
          error={form.fieldError("timezone")}
          hint={
            <>
              The daily digest goes out at 08:00 here.
              {localTime ? ` It is ${localTime} there now.` : null}
              {canEdit && suggest ? (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => setTimezone(suggest)}
                    className="rounded-sm font-medium text-ink underline decoration-line-strong underline-offset-2 transition-colors duration-150 hover:decoration-ink"
                  >
                    Use {suggest.replaceAll("_", " ")}
                  </button>
                </>
              ) : null}
            </>
          }
        >
          <Select name="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={!canEdit}>
            {grouped.map(([area, list]) =>
              area ? (
                <optgroup key={area} label={area}>
                  {list.map((zone) => (
                    <option key={zone} value={zone}>
                      {placeName(zone)}
                    </option>
                  ))}
                </optgroup>
              ) : (
                list.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))
              ),
            )}
          </Select>
        </Field>
        <Field label="Slug" hint="Used in links. It does not change when you rename the workspace.">
          <Input name="slug" value={tenant.slug} readOnly className="font-mono" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">Created</p>
          <p className="text-base text-ink-muted tabular-nums">{formatDate(tenant.created_at)}</p>
        </div>
      </CardBody>
      {canEdit ? (
        <CardFooter>
          <Button type="submit" loading={form.pending} disabled={!nameChanged && !zoneChanged}>
            Save changes
          </Button>
        </CardFooter>
      ) : null}
    </form>
  );
}
