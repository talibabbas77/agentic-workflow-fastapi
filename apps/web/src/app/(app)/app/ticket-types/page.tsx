import type { Metadata } from "next";
import { NotYet } from "@/components/app/not-yet";
import { TicketTypesIllustration } from "@/components/illustrations/illustrations";

export const metadata: Metadata = { title: "Ticket types" };

export default function TicketTypesPage() {
  return (
    <NotYet
      title="Ticket types"
      description="The kinds of requests your team handles."
      illustration={<TicketTypesIllustration />}
      emptyTitle="No ticket types yet"
    >
      <p>
        Define types such as refunds or bug reports, with the details each one needs. Handoffs then arrive sorted
        and complete.
      </p>
    </NotYet>
  );
}
