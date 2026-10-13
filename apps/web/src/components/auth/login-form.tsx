"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { PasswordInput } from "@/components/ui/password-input";
import { TextLink } from "@/components/ui/text-link";
import { api } from "@/lib/api/browser";
import { settle } from "@/lib/api/result";
import { hardNavigate } from "@/lib/navigation";
import { safeNext } from "@/lib/safe-next";
import { useApiForm } from "@/lib/use-api-form";

export function LoginForm() {
  const form = useApiForm();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const ok = form.check({
      email: !email && "Enter your email address.",
      password: !password && "Enter your password.",
    });
    if (!ok) return;
    await form.run(
      () => settle(api.POST("/v1/auth/login", { body: { email, password } })),
      () => hardNavigate(safeNext(new URLSearchParams(window.location.search).get("next"))),
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
      <Field label="Email" error={form.fieldError("email")}>
        <Input name="email" type="email" autoComplete="email" inputMode="email" autoFocus />
      </Field>
      <Field
        label="Password"
        error={form.fieldError("password")}
        aside={
          <TextLink href="/forgot-password" className="text-sm">
            Forgot password?
          </TextLink>
        }
      >
        <PasswordInput name="password" autoComplete="current-password" />
      </Field>
      <Button type="submit" block loading={form.pending} className="mt-1">
        Log in
      </Button>
      <p className="text-center text-base text-ink-muted">
        New to Docent? <TextLink href="/signup">Create an account</TextLink>
      </p>
    </form>
  );
}
