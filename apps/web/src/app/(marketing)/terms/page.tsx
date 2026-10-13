import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Docent, in plain language. A draft pending legal review.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      sections={[
        {
          title: "The service",
          body: [
            "Docent answers your customers' questions from the documents you teach it and hands conversations to your team. We work to keep it available and correct, but answers come from your content and you are responsible for that content.",
          ],
        },
        {
          title: "Your account",
          body: [
            "Keep your login details safe and tell us if you think someone else has used them. You are responsible for what happens in your workspace and for the teammates you invite.",
          ],
        },
        {
          title: "Your content",
          body: [
            "You keep ownership of everything you upload and of your customers' conversations. You give us permission to process it only to provide the service to you. You confirm you have the right to use what you upload.",
          ],
        },
        {
          title: "Acceptable use",
          body: [
            "Do not use Docent to break the law, to send spam, to attack other systems, or to collect data you are not allowed to collect. Do not try to get around plan limits or another workspace's isolation.",
          ],
        },
        {
          title: "Plans and payment",
          body: [
            "Plans are billed monthly in US dollars at the price shown on the pricing page. Each plan has a hard cap on AI replies; reaching it never creates an extra charge. You can cancel at any time and keep access until the end of the paid month.",
          ],
        },
        {
          title: "Ending the service",
          body: [
            "You can close your workspace at any time. We may suspend a workspace that breaks these terms, and we will tell you why. After a workspace is closed, its data is deleted as described in the privacy page.",
          ],
        },
        {
          title: "Questions",
          body: [`Write to ${CONTACT_EMAIL}.`],
        },
      ]}
    />
  );
}
