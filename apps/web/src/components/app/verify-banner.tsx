import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { ResendVerificationButton } from "./resend-verification";

export function VerifyBanner({ email }: { email: string }) {
  return (
    <div
      role="status"
      data-testid="verify-banner"
      className="fade-in flex flex-col gap-3 rounded-md border border-rust/40 bg-rust-soft px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4"
    >
      <EnvelopeSimpleIcon aria-hidden="true" className="hidden size-5 shrink-0 text-rust sm:block" />
      <p className="flex-1 text-base text-ink">
        <span className="font-medium">Confirm your email to invite teammates.</span>{" "}
        <span className="text-ink-muted">
          We sent a link to <span className="text-ink">{email}</span>.
        </span>
      </p>
      <div className="shrink-0">
        <ResendVerificationButton />
      </div>
    </div>
  );
}
