import { StatusPage } from "@/components/app/status-page";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="This page does not exist"
      actions={
        <ButtonLink href="/app" variant="secondary">
          Go to Docent
        </ButtonLink>
      }
    >
      <p>The link may be old, or the address has a typo.</p>
    </StatusPage>
  );
}
