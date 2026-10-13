import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DiagramPanel, PageIntro, Section } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { AnswerFlow } from "@/components/workflow/answer-flow";
import { HandoffFlow } from "@/components/workflow/handoff-flow";
import { IdentityFlow } from "@/components/workflow/identity-flow";
import { TeachingFlow } from "@/components/workflow/teaching-flow";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Docent learns from your docs, answers with citations, knows which customer is asking, and hands conversations to your team by email.",
};

export default function HowItWorksPage() {
  return (
    <>
      <PageIntro title="How Docent works">
        <p>
          Four parts: you teach the agent from your docs, it answers in a widget on your site, it can know which
          customer is asking, and it hands the rest to your team. Each part below shows what happens and where it stops.
        </p>
      </PageIntro>

      <Section
        id="teaching"
        title="1. Teach the agent"
        intro="Docent only knows what you give it. You add sources in the dashboard, and it keeps them in sync when you ask."
      >
        <DiagramPanel>
          <TeachingFlow />
        </DiagramPanel>
        <Details>
          <Detail title="What you can add">
            PDF, Word (.docx), Markdown, text, and HTML files up to 20 MB each, a single web page, or a sitemap with up
            to 200 pages.
          </Detail>
          <Detail title="What happens next">
            Docent extracts the text, splits it into short passages under their headings, and indexes each passage
            for search by meaning and by keyword.
          </Detail>
          <Detail title="Who sees what">
            Mark each source for everyone or for signed-in customers only. Anonymous visitors never get answers from
            signed-in content.
          </Detail>
        </Details>
      </Section>

      <Section
        id="answers"
        title="2. Answer with sources"
        intro="Every answer is built from passages Docent found in your sources, and it shows the page each one came from."
      >
        <DiagramPanel>
          <AnswerFlow />
        </DiagramPanel>
        <Details>
          <Detail title="Search first">
            For each question Docent finds the most relevant passages in your sources before it writes anything.
          </Detail>
          <Detail title="Cite the page">
            The answer links to the document and section it relied on, so customers and your team can check it.
          </Detail>
          <Detail title="No source, no answer">
            If no passage supports an answer, Docent says it does not know and hands over. It does not fill the gap
            from general knowledge.
          </Detail>
        </Details>
      </Section>

      <Section
        id="identity"
        title="3. Know who is asking"
        intro="With identified mode, Docent can answer for a specific account. It learns who the customer is from your server, never from the page or the chat."
      >
        <DiagramPanel>
          <IdentityFlow />
        </DiagramPanel>
        <Details>
          <Detail title="Your server signs">
            When a customer is logged in, your backend signs a short-lived token (ES256, at most 15 minutes) with their
            user id and any fields you allow, such as plan or account id.
          </Detail>
          <Detail title="Docent verifies">
            Docent checks the signature with the public key you uploaded. It never reads your cookies or storage, and it
            never trusts a name typed into the chat.
          </Detail>
          <Detail title="What it costs you">
            Anonymous mode is one script tag. Identified mode needs a small signing step on your server. The{" "}
            <TextLink href="/docs">install guide</TextLink> has snippets for Node, Python, Ruby, PHP, and Go.
          </Detail>
        </Details>
      </Section>

      <Section
        id="handoff"
        title="4. Hand off to your team"
        intro="Docent stops and passes the conversation to people when it should. Your team gets the whole context instead of a cold ticket."
      >
        <DiagramPanel>
          <HandoffFlow />
        </DiagramPanel>
        <Details>
          <Detail title="When it hands off">
            No source supports an answer, the customer asks for a person, or the topic is restricted: legal questions,
            security reports, account deletion, or billing disputes.
          </Detail>
          <Detail title="What your team gets">
            The conversation, a short summary of what was asked and what Docent tried, and the customer&apos;s details
            when they are signed in.
          </Detail>
          <Detail title="How you reply">
            Your team replies by email from the inbox, and the customer gets it by email. There is no live chat in this
            version.
          </Detail>
        </Details>
      </Section>

      <section aria-labelledby="next-heading" className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-8 md:flex-row md:items-center md:justify-between">
          <h2 id="next-heading" className="text-2xl text-ink">
            Ready to try it with your own docs
          </h2>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/signup">Start free trial</ButtonLink>
            <ButtonLink href="/docs" variant="secondary">
              Read the install guide
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}

function Details({ children }: { children: ReactNode }) {
  return <dl className="mt-8 grid gap-x-10 gap-y-6 md:grid-cols-3">{children}</dl>;
}

function Detail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="font-medium text-ink">{title}</dt>
      <dd className="text-base text-ink-muted">{children}</dd>
    </div>
  );
}
