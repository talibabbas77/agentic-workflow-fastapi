import type { Metadata } from "next";
import { NotYet } from "@/components/app/not-yet";
import { KnowledgeIllustration } from "@/components/illustrations/illustrations";

export const metadata: Metadata = { title: "Knowledge" };

export default function KnowledgePage() {
  return (
    <NotYet
      title="Knowledge"
      description="The documents the agent answers from."
      illustration={<KnowledgeIllustration />}
      emptyTitle="Nothing to answer from yet"
    >
      <p>
        Teach the agent by adding help articles, PDFs, and pages from your site. It answers only from what you add
        here, and every answer cites the page it came from.
      </p>
    </NotYet>
  );
}
