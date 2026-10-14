import { permanentRedirect } from "next/navigation";

/** Usage moved into Billing, next to the plan it counts against. */
export default function UsagePage() {
  permanentRedirect("/app/billing");
}
