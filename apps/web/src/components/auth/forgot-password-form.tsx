"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { TextLink, textLinkClasses } from "@/components/ui/text-link";
import { api } from "@/lib/api/browser";
import { settle } from "@/lib/api/result";
import { useApiForm } from "@/lib/use-api-form";

export function ForgotPasswordForm() {
  const form = useApiForm();
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!form.check({ email: !email && "Enter the email you log in with." })) return;
    await form.run(
      () => settle(api.POST("/v1/auth/password/forgot", { body: { email } })),
      () => setSentTo(email),
    );
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-5">
        <FormAlert tone="success">
          If an account exists for <span className="font-medium">{sentTo}</span>, we sent it a link to choose a
          new password. The link works for 60 minutes.
        </FormAlert>
        <p className="text-base text-ink-muted">
          No email after a few minutes? Check spam, or{" "}
          <button type="button" className={textLinkClasses} onClick={() => setSentTo(null)}>
            try another address
          </button>
          .
        </p>
        <TextLink href="/login" className="self-start text-base">
          Back to log in
        </TextLink>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
      <Field label="Email" error={form.fieldError("email")}>
        <Input name="email" type="email" autoComplete="email" inputMode="email" autoFocus />
      </Field>
      <Button type="submit" block loading={form.pending}>
        Send reset link
      </Button>
      <p className="text-center text-base text-ink-muted">
        Remembered it? <TextLink href="/login">Log in</TextLink>
      </p>
    </form>
  );
}
