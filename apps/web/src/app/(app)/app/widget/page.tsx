import type { Metadata } from "next";
import { NotYet } from "@/components/app/not-yet";
import { WidgetIllustration } from "@/components/illustrations/illustrations";

export const metadata: Metadata = { title: "Widget" };

export default function WidgetPage() {
  return (
    <NotYet
      title="Widget"
      description="The chat window your visitors use on your site."
      illustration={<WidgetIllustration />}
      emptyTitle="The widget is not on your site yet"
    >
      <p>
        Add one script tag to show the widget. To let it know who is asking, your server signs a short-lived token
        for each logged-in visitor.
      </p>
    </NotYet>
  );
}
