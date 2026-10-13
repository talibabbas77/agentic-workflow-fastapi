"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { PasswordInput } from "@/components/ui/password-input";
import { TextLink } from "@/components/ui/text-link";
import { api } from "@/lib/api/browser";
import { settle } from "@/lib/api/result";
import { hardNavigate } from "@/lib/navigation";
import { useApiForm } from "@/lib/use-api-form";
import { PASSWORD_MIN, PasswordHint } from "./password-hint";

export function SignupForm() {
  const form = useApiForm();
  const [password, setPassword] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
      workspace_name: String(data.get("workspace_name") ?? "").trim(),
    };
    const ok = form.check({
      name: !body.name && "Enter your name.",
      email: !body.email && "Enter your work email.",
      password: body.password.length < PASSWORD_MIN && `Use at least ${PASSWORD_MIN} characters.`,
      workspace_name: !body.workspace_name && "Name your workspace. You can change it later.",
    });
    if (!ok) return;
    await form.run(
      () => settle(api.POST("/v1/auth/signup", { body })),
      () => hardNavigate("/app"),
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
      <Field label="Your name" error={form.fieldError("name")}>
        <Input name="name" autoComplete="name" autoFocus />
      </Field>
      <Field label="Work email" error={form.fieldError("email")}>
        <Input name="email" type="email" autoComplete="email" inputMode="email" />
      </Field>
      <Field label="Password" error={form.fieldError("password")} hint={<PasswordHint length={password.length} />}>
        <PasswordInput
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Field
        label="Workspace name"
        error={form.fieldError("workspace_name")}
        hint="Usually your company or team. You can change it later."
      >
        <Input name="workspace_name" autoComplete="organization" />
      </Field>
      <Button type="submit" block loading={form.pending} className="mt-1">
        Create account
      </Button>
      <p className="text-center text-base text-ink-muted">
        Already have an account? <TextLink href="/login">Log in</TextLink>
      </p>
    </form>
  );
}
