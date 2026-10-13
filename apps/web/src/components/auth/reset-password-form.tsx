"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { PasswordInput } from "@/components/ui/password-input";
import { TextLink } from "@/components/ui/text-link";
import { api } from "@/lib/api/browser";
import { settle } from "@/lib/api/result";
import { AuthHeading } from "./auth-heading";
import { PASSWORD_MIN, PasswordHint } from "./password-hint";
import { useApiForm } from "./use-api-form";
import { hardNavigate } from "@/lib/navigation";

export function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const form = useApiForm();
  const [password, setPassword] = useState("");

  if (!token) {
    return (
      <>
        <AuthHeading title="Choose a new password" />
        <FormAlert>
          This reset link is incomplete. <TextLink href="/forgot-password">Request a new link</TextLink>.
        </FormAlert>
      </>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.check({ password: password.length < PASSWORD_MIN && `Use at least ${PASSWORD_MIN} characters.` })) {
      return;
    }
    await form.run(
      () => settle(api.POST("/v1/auth/password/reset", { body: { token: token!, password } })),
      () => hardNavigate("/app"),
    );
  }

  const tokenProblem = form.error && !form.error.fields && form.error.code !== "rate_limited";

  return (
    <>
      <AuthHeading title="Choose a new password">You will be logged in once it is saved.</AuthHeading>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {form.formError ? (
          <FormAlert>
            {form.formError}
            {tokenProblem ? (
              <>
                {" "}
                <TextLink href="/forgot-password">Request a new link</TextLink>.
              </>
            ) : null}
          </FormAlert>
        ) : null}
        <Field label="New password" error={form.fieldError("password")} hint={<PasswordHint length={password.length} />}>
          <PasswordInput
            name="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" block loading={form.pending}>
          Save password and log in
        </Button>
      </form>
    </>
  );
}
