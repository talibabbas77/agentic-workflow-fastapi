"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Spinner } from "@/components/ui/spinner";
import { TextLink } from "@/components/ui/text-link";
import { api } from "@/lib/api/browser";
import { settle } from "@/lib/api/result";
import { AuthHeading } from "./auth-heading";

type State =
  | { kind: "verifying" }
  | { kind: "done" }
  | { kind: "failed"; message: string; loggedIn: boolean }
  | { kind: "resent" };

async function verify(token: string): Promise<State> {
  const result = await settle(api.POST("/v1/auth/verify-email", { body: { token } }));
  if (result.ok) return { kind: "done" };
  const me = await settle(api.GET("/v1/auth/me"));
  return { kind: "failed", message: result.error.message, loggedIn: me.ok };
}

export function VerifyEmail() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<State>({ kind: "verifying" });
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  // Tokens are single use, so the request must go out once even when development runs effects twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (token) {
      verify(token).then(setState);
      return;
    }
    settle(api.GET("/v1/auth/me")).then((me) =>
      setState({ kind: "failed", message: "This confirmation link is incomplete.", loggedIn: me.ok }),
    );
  }, [token]);

  async function resend() {
    setResending(true);
    setResendError(null);
    const result = await settle(api.POST("/v1/auth/verify-email/resend"));
    setResending(false);
    if (result.ok) setState({ kind: "resent" });
    else setResendError(result.error.message);
  }

  if (state.kind === "verifying") {
    return (
      <>
        <AuthHeading title="Confirming your email" />
        <div className="flex items-center gap-3 text-base text-ink-muted">
          <Spinner label="Confirming" />
          <span>One moment.</span>
        </div>
      </>
    );
  }

  if (state.kind === "done") {
    return (
      <>
        <AuthHeading title="Email confirmed">You can now invite your team and set up the agent.</AuthHeading>
        <ButtonLink href="/app" block>
          Continue to Docent
        </ButtonLink>
      </>
    );
  }

  if (state.kind === "resent") {
    return (
      <>
        <AuthHeading title="Check your inbox" />
        <FormAlert tone="success">We sent a new confirmation link. It works for 24 hours.</FormAlert>
        <TextLink href="/app" className="mt-6 inline-block text-base">
          Back to Docent
        </TextLink>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="That link did not work" />
      <div className="flex flex-col gap-5">
        <FormAlert>{state.message}</FormAlert>
        {state.loggedIn ? (
          <>
            {resendError ? <FormAlert>{resendError}</FormAlert> : null}
            <Button block onClick={resend} loading={resending}>
              Send a new link
            </Button>
            <TextLink href="/app" className="self-center text-base">
              Back to Docent
            </TextLink>
          </>
        ) : (
          <p className="text-base text-ink-muted">
            <TextLink href={`/login?next=${encodeURIComponent("/app")}`}>Log in</TextLink> to get a new
            confirmation link.
          </p>
        )}
      </div>
    </>
  );
}
