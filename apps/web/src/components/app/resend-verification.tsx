"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";

function useResend() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  async function resend() {
    setPending(true);
    const result = await request(api.POST("/v1/auth/verify-email/resend"));
    setPending(false);
    if (result.ok) {
      toast({ tone: "success", title: "Confirmation email sent", description: "The link works for 24 hours." });
    } else {
      toast({ tone: "error", title: "Could not send the email", description: result.error.message });
    }
  }
  return { pending, resend };
}

export function ResendVerificationButton() {
  const { pending, resend } = useResend();
  return (
    <Button variant="secondary" size="sm" loading={pending} onClick={resend}>
      Resend email
    </Button>
  );
}

/** Wraps a workflow node so clicking it sends a new confirmation link. */
export function ResendVerificationNode({ className, children }: { className: string; children: ReactNode }) {
  const { pending, resend } = useResend();
  return (
    <button type="button" className={className} onClick={resend} disabled={pending} aria-busy={pending || undefined}>
      {children}
    </button>
  );
}
