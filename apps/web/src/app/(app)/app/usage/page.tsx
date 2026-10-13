import type { Metadata } from "next";
import { NotYet } from "@/components/app/not-yet";
import { UsageIllustration } from "@/components/illustrations/illustrations";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <NotYet
      title="Usage"
      description="AI replies this month against your plan's cap."
      illustration={<UsageIllustration />}
      emptyTitle="No usage yet"
    >
      <p>
        Your plan has a hard monthly cap, so the bill never surprises you. If you reach it, the widget switches to a
        contact form for your team instead of going quiet.
      </p>
    </NotYet>
  );
}
