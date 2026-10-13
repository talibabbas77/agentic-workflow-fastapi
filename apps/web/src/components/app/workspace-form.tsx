"use client";

import type { Tenant } from "@docent/api-client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useApiForm } from "@/components/auth/use-api-form";
import { Button } from "@/components/ui/button";
import { CardBody, CardFooter } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useToast } from "@/components/ui/toast";
import { api, redirectToLogin } from "@/lib/api/browser";
import { settle } from "@/lib/api/result";
import { formatDate } from "@/lib/format";

export function WorkspaceForm({ tenant, canEdit }: { tenant: Tenant; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const form = useApiForm();
  const [name, setName] = useState(tenant.name);
  const changed = name.trim() !== tenant.name && name.trim().length > 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!form.check({ name: !trimmed && "Enter a workspace name." })) return;
    await form.run(
      async () => {
        const result = await settle(api.PATCH("/v1/tenant", { body: { name: trimmed } }));
        if (result.status === 401) redirectToLogin();
        return result;
      },
      () => {
        form.setPending(false);
        toast({ tone: "success", title: "Workspace name saved" });
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
        <Field label="Slug" hint="Used in links. It does not change when you rename the workspace.">
          <Input name="slug" value={tenant.slug} readOnly className="font-mono" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">Created</p>
          <p className="text-base text-ink-muted tabular">{formatDate(tenant.created_at)}</p>
        </div>
      </CardBody>
      {canEdit ? (
        <CardFooter>
          <Button type="submit" loading={form.pending} disabled={!changed}>
            Save changes
          </Button>
        </CardFooter>
      ) : null}
    </form>
  );
}
