import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Docent collects, why, how long it keeps it, and who it shares it with. A draft pending legal review.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      sections={[
        {
          title: "Who this covers",
          body: [
            "Two groups of people: the teams who use Docent (our customers), and the people who ask questions in a Docent widget on our customers' sites (their customers).",
            "For the second group, our customer decides what Docent is used for and we process the data on their behalf.",
          ],
        },
        {
          title: "What we collect",
          body: [
            "For your team: names, email addresses, a hashed password, and what you do in the dashboard.",
            "For your workspace: the documents and pages you teach the agent, and your settings.",
            "For your customers: their questions, the agent's answers, and, in identified mode, the fields your server signs, such as their user id, name, email, plan, or account id. The widget does not read cookies or storage on your site.",
          ],
        },
        {
          title: "Why we use it",
          body: [
            "To answer your customers from your docs, hand conversations to your team, send the emails you ask for, keep the service secure, and bill you.",
            "We never use your documents or your customers' conversations to train models.",
          ],
        },
        {
          title: "How long we keep it",
          body: [
            "Conversations are kept for 90 days by default, then deleted. Documents stay until you delete them or close your workspace. Encrypted backups are kept for a limited time and then removed.",
          ],
        },
        {
          title: "Who we share it with",
          body: [
            "Only the providers we need to run the service, such as hosting, email delivery, and the AI model provider that writes answers. Each one may use the data only to provide that service. We do not sell personal data.",
          ],
        },
        {
          title: "Your choices",
          body: [
            `You can ask for a copy of your data, a correction, or deletion. Write to ${CONTACT_EMAIL}. If you are one of our customers' customers, you can also ask the company whose widget you used.`,
          ],
        },
      ]}
    />
  );
}
