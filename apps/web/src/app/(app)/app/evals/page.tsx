import type { Metadata } from "next";
import { NotYet } from "@/components/app/not-yet";
import { EvalsIllustration } from "@/components/illustrations/illustrations";

export const metadata: Metadata = { title: "Evals" };

export default function EvalsPage() {
  return (
    <NotYet
      title="Evals"
      description="Checks that the agent still answers correctly."
      illustration={<EvalsIllustration />}
      emptyTitle="No test questions yet"
    >
      <p>
        Save real questions with the answers you expect. Run them before you change what the agent knows, and see
        what got better or worse.
      </p>
    </NotYet>
  );
}
