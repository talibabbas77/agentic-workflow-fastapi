"use client";

import type { InvitationLookup, Me, Role } from "@docent/api-client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { PasswordInput } from "@/components/ui/password-input";
import { TextLink } from "@/components/ui/text-link";
import { api } from "@/lib/api/browser";
import { settle } from "@/lib/api/result";
import { AuthHeading } from "./auth-heading";
import { AuthSkeleton } from "./auth-skeleton";
import { PASSWORD_MIN, PasswordHint } from "./password-hint";
import { useApiForm } from "./use-api-form";
import { hardNavigate } from "@/lib/navigation";

type Loaded =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; invite: InvitationLookup; me: Me | null };

const withArticle: Record<Role, string> = { owner: "an owner", admin: "an admin", agent: "an agent" };

export function InviteFlow() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([
      settle(api.GET("/v1/invitations/lookup", { params: { query: { token } } })),
      settle(api.GET("/v1/auth/me")),
    ]).then(([lookup, me]) => {
      if (cancelled) return;
      if (!lookup.ok) setState({ kind: "invalid", message: lookup.error.message });
      else setState({ kind: "ready", invite: lookup.data, me: me.ok ? me.data : null });
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token || state.kind === "invalid") {
    return (
      <>
        <AuthHeading title="This invitation cannot be used" />
        <FormAlert>{token && state.kind === "invalid" ? state.message : "This invitation link is incomplete."}</FormAlert>
        <p className="mt-6 text-base text-ink-muted">
          Ask the person who invited you to send a new invitation, or <TextLink href="/login">log in</TextLink>.
        </p>
      </>
    );
  }

  if (state.kind === "loading") return <AuthSkeleton />;

  const { invite, me } = state;
  const inviter = invite.inviter_name ?? "A teammate";

  if (invite.expired) {
    return (
      <>
        <AuthHeading title="This invitation has expired">
          {invite.inviter_name ?? "The person who invited you"} can send a new one from the Members page in{" "}
          {invite.workspace_name}.
        </AuthHeading>
        <ButtonLink href="/login" variant="secondary" block>
          Go to log in
        </ButtonLink>
      </>
    );
  }

  const heading = (
    <AuthHeading title={`Join ${invite.workspace_name} as ${withArticle[invite.role]}`}>
      {inviter} invited <span className="font-medium text-ink">{invite.email}</span> to answer support questions
      with Docent.
    </AuthHeading>
  );

  if (me && me.user.email.toLowerCase() === invite.email.toLowerCase()) {
    return (
      <>
        {heading}
        <AcceptButton token={token!} />
      </>
    );
  }

  if (me) {
    return (
      <>
        {heading}
        <SwitchAccount current={me.user.email} invited={invite.email} />
      </>
    );
  }

  if (invite.account_exists) {
    const next = `/invite?token=${encodeURIComponent(token!)}`;
    return (
      <>
        {heading}
        <div className="flex flex-col gap-4">
          <p className="text-base text-ink-muted">You already have a Docent account. Log in with it to accept.</p>
          <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} block>
            Log in to accept
          </ButtonLink>
        </div>
      </>
    );
  }

  return (
    <>
      {heading}
      <CreateAccount token={token!} email={invite.email} />
    </>
  );
}

function AcceptButton({ token }: { token: string }) {
  const form = useApiForm();
  return (
    <div className="flex flex-col gap-4">
      {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
      <Button
        block
        loading={form.pending}
        onClick={() =>
          form.run(
            () => settle(api.POST("/v1/invitations/accept", { body: { token } })),
            () => hardNavigate("/app"),
          )
        }
      >
        Accept invitation
      </Button>
    </div>
  );
}

function SwitchAccount({ current, invited }: { current: string; invited: string }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <FormAlert>
        You are logged in as <span className="font-medium">{current}</span>. This invitation is for{" "}
        <span className="font-medium">{invited}</span>.
      </FormAlert>
      <Button
        block
        variant="secondary"
        loading={pending}
        onClick={async () => {
          setPending(true);
          await settle(api.POST("/v1/auth/logout"));
          window.location.reload();
        }}
      >
        Log out and continue
      </Button>
    </div>
  );
}

function CreateAccount({ token, email }: { token: string; email: string }) {
  const form = useApiForm();
  const [password, setPassword] = useState("");
  const next = `/invite?token=${encodeURIComponent(token)}`;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    const ok = form.check({
      name: !name && "Enter your name.",
      password: password.length < PASSWORD_MIN && `Use at least ${PASSWORD_MIN} characters.`,
    });
    if (!ok) return;
    await form.run(
      () => settle(api.POST("/v1/invitations/accept", { body: { token, name, password } })),
      () => hardNavigate("/app"),
    );
  }

  const accountExists = form.error?.code === "account_exists";

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {form.formError ? (
        <FormAlert>
          {form.formError}
          {accountExists ? (
            <>
              {" "}
              <TextLink href={`/login?next=${encodeURIComponent(next)}`}>Log in to accept</TextLink>.
            </>
          ) : null}
        </FormAlert>
      ) : null}
      <Field label="Email" hint="The invitation is tied to this address.">
        <Input name="email" type="email" value={email} readOnly autoComplete="username" />
      </Field>
      <Field label="Your name" error={form.fieldError("name")}>
        <Input name="name" autoComplete="name" autoFocus />
      </Field>
      <Field label="Password" error={form.fieldError("password")} hint={<PasswordHint length={password.length} />}>
        <PasswordInput
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Button type="submit" block loading={form.pending} className="mt-1">
        Create account and join
      </Button>
    </form>
  );
}
