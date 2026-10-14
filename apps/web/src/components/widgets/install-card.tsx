import type { Widget } from "@docent/api-client";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { CodeBlock } from "@/components/marketing/code-block";
import { CopyButton } from "@/components/marketing/copy-button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/cn";

/** The anonymous script tag, and the values the identified setup in the install guide needs. */
export function InstallCard({ widget }: { widget: Widget }) {
  const snippet = `<script src="${widget.embed_origin}/widget/v1/loader.js" data-widget="${widget.public_id}" async></script>`;
  const activeKeys = widget.keys.filter((key) => key.status === "active");

  return (
    <Card aria-labelledby="install-heading">
      <CardHeader>
        <CardTitle id="install-heading">Install</CardTitle>
        <CardDescription>Put the widget on every page of your site that should show it.</CardDescription>
      </CardHeader>
      <CardBody className="flex flex-col gap-8">
        <section aria-labelledby="install-anonymous-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id="install-anonymous-heading" className="text-md text-ink">
              Anonymous visitors
            </h3>
            <p className="text-base text-ink-muted">
              {widget.anonymous_enabled
                ? "Paste this tag before the closing body tag. Docent answers from the sources marked for everyone."
                : "Anonymous visitors are off for this widget, so this tag alone does not start a chat. Use the signed-in setup below."}
            </p>
          </div>
          <CodeBlock label="HTML" code={snippet} />
        </section>

        <section aria-labelledby="install-identified-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 id="install-identified-heading" className="text-md text-ink">
              Signed-in customers
            </h3>
            <p className="text-base text-ink-muted">
              Your server signs a short-lived token for each signed-in customer, and the page hands it to the widget.
              Follow the{" "}
              <TextLink
                href="/docs#identified"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1"
              >
                install guide
                <ArrowSquareOutIcon aria-hidden="true" className="size-3.5" />
                <span className="sr-only">(opens in a new tab)</span>
              </TextLink>{" "}
              with these values.
            </p>
          </div>
          <ul aria-label="Values for the install guide" className="divide-y divide-line rounded-md border border-line">
            <Value term="Widget id" env="DOCENT_WIDGET_ID" value={widget.public_id} />
            {activeKeys.length === 0 ? (
              <Value term="Key id" env="DOCENT_KEY_ID" missing="Add a signing key first." />
            ) : (
              activeKeys.map((key) => <Value key={key.kid} term="Key id" env="DOCENT_KEY_ID" value={key.kid} />)
            )}
          </ul>
        </section>
      </CardBody>
    </Card>
  );
}

function Value({ term, env, value, missing }: { term: string; env: string; value?: string; missing?: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-6">
        <span className="flex flex-col sm:w-44">
          <span className="text-sm font-medium text-ink">{term}</span>
          <code className="font-mono text-xs text-ink-muted">{env}</code>
        </span>
        <span className={cn("min-w-0 truncate text-base", value ? "font-mono text-ink" : "text-ink-muted")}>
          {value ?? missing}
        </span>
      </div>
      {value ? <CopyButton text={value} label={`${term} ${value}`} /> : null}
    </li>
  );
}
