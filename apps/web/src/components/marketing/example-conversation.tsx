import { BookOpenTextIcon, HeadsetIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A sample conversation drawn in HTML, clearly labeled as fictional. Lumen Notes
 * is a made-up company; nothing here is a real customer or a screenshot.
 */
export function ExampleConversation() {
  return (
    <figure className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md border border-line-strong bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <span className="text-sm font-medium text-ink">Lumen Notes help</span>
          <span className="rounded-sm border border-line-strong px-1.5 text-xs font-medium text-ink-muted">
            Example
          </span>
        </div>
        <ol className="flex flex-col gap-4 px-4 py-5" aria-label="Messages">
          <Message from="visitor">I paid for the yearly plan last week. Can I still get a refund?</Message>
          <Message
            from="agent"
            note={
              <Chip icon={<BookOpenTextIcon aria-hidden="true" className="size-3.5" />}>
                <span className="sr-only">Source: </span>Billing and refunds › Refunds
              </Chip>
            }
          >
            Yes. Yearly plans can be refunded in full within 30 days of payment. Ask from Settings, then Billing, and the
            money reaches your card in 5 to 10 business days.
          </Message>
          <Message from="visitor">Can the refund go to a different card?</Message>
          <Message
            from="agent"
            note={
              <Chip icon={<HeadsetIcon aria-hidden="true" className="size-3.5" />}>Handed to the Lumen Notes team</Chip>
            }
          >
            The Lumen Notes help center does not cover that, so I have passed your question to their support team with
            a summary. They will reply by email.
          </Message>
        </ol>
      </div>
      <figcaption className="text-sm text-ink-muted">
        Example conversation with fictional data. Lumen Notes is not a real company.
      </figcaption>
    </figure>
  );
}

function Message({ from, note, children }: { from: "visitor" | "agent"; note?: ReactNode; children: ReactNode }) {
  const visitor = from === "visitor";
  return (
    <li className={cn("flex flex-col gap-2", visitor ? "items-end" : "items-start")}>
      <span className="sr-only">{visitor ? "Visitor:" : "Docent:"}</span>
      <p
        className={cn(
          "max-w-[85%] rounded-md px-3.5 py-2.5 text-base",
          visitor ? "bg-surface-2 text-ink" : "border border-line bg-paper text-ink",
        )}
      >
        {children}
      </p>
      {note}
    </li>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-rust-soft px-2 py-1 text-sm text-ink">
      <span className="text-rust">{icon}</span>
      {children}
    </span>
  );
}
