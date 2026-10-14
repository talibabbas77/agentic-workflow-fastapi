import { ArrowRightIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { TextLink } from "@/components/ui/text-link";
import { SIGNING_EXAMPLES } from "@/lib/signing-examples";
import { CodeBlock } from "./code-block";
import { CodeTabs } from "./code-tabs";

/** What POST /v1/widget/sessions checks, from docs/ARCHITECTURE.md section 4. */
const checks: { title: string; body: string }[] = [
  {
    title: "ES256 signature",
    body: "Checked with the public key you uploaded. We store only public keys, so nothing on our side can sign for your users.",
  },
  {
    title: "Key id",
    body: "Must match an active key for the widget. Two keys can be active at once, so you can rotate them.",
  },
  {
    title: "Audience and issuer",
    body: "The audience must be docent and the issuer your widget id, so a token made for something else is refused.",
  },
  {
    title: "At most 15 minutes",
    body: "Issued and expiry times are checked, with 60 seconds allowed for clock difference.",
  },
  {
    title: "Single-use token id",
    body: "Each token id is stored with its session. A token sent a second time is rejected.",
  },
  {
    title: "Allowed sites only",
    body: "The page showing the widget must be on your list of allowed domains.",
  },
  {
    title: "Only the claims you allow",
    body: "Custom fields are filtered to the keys you choose, up to 20, so the agent never sees more than you meant.",
  },
];

/** The signing function from each example, so the panel stays short. The full files are in the docs. */
function excerpt(code: string) {
  const lines = code.split("\n");
  const from = lines.findIndex((line) => /^(export )?(function|def|func) docent_?token/i.test(line));
  if (from < 0) return code;
  const out: string[] = [];
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    if (i > from && line.length > 0 && !/^\s/.test(line)) {
      if (line === "{") {
        out.push(line);
        continue;
      }
      if (/^(\}|end)\s*$/.test(line)) out.push(line);
      break;
    }
    out.push(line);
  }
  return out.join("\n").trimEnd();
}

export function IdentityChecks() {
  return (
    <div className="mk-reveal grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
      <div className="flex flex-col gap-5">
        <h3 className="text-lg text-ink">What Docent checks before a session starts</h3>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {checks.map((check) => (
            <li key={check.title} className="grid gap-x-5 gap-y-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <span className="flex items-start gap-2.5 text-base font-medium text-ink">
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-ink text-paper"
                >
                  <CheckIcon className="size-2.5" weight="bold" />
                </span>
                {check.title}
              </span>
              <span className="pl-7 text-sm text-ink-muted sm:pl-0">{check.body}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-muted">
          If any check fails, no session starts. Anonymous visitors, when you allow them, get answers from public docs
          only.
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-lg text-ink">Sign a token on your server</h3>
          <TextLink href="/docs#identified" className="inline-flex items-center gap-1 text-base">
            Full guide
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </TextLink>
        </div>
        <p className="text-sm text-ink-muted">
          The signing function from each example. Return the token from a route only logged-in users can reach.
        </p>
        <CodeTabs
          label="Signing examples"
          tabs={SIGNING_EXAMPLES.map((example) => ({
            name: example.name,
            panel: <CodeBlock label={`${example.label}, signing function`} code={excerpt(example.code)} />,
          }))}
        />
      </div>
    </div>
  );
}
