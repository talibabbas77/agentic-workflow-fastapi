import type { Metadata } from "next";
import { NotYet } from "@/components/app/not-yet";
import { InboxIllustration } from "@/components/illustrations/illustrations";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return (
    <NotYet
      title="Inbox"
      description="Conversations the agent handed to your team."
      illustration={<InboxIllustration />}
      emptyTitle="No conversations yet"
    >
      <p>
        When Docent cannot find a source for an answer, it hands the conversation here with a short summary, and your
        team replies by email.
      </p>
    </NotYet>
  );
}
