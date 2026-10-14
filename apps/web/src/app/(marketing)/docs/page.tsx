import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/marketing/code-block";
import { CodeTabs } from "@/components/marketing/code-tabs";
import { PageIntro, Section } from "@/components/marketing/section";
import { SIGNING_EXAMPLES } from "@/lib/signing-examples";
import { WIDGET_ORIGIN } from "@/lib/site";

export const metadata: Metadata = {
  title: "Install guide",
  description:
    "Add the Docent widget with one script tag, and turn on identified mode by signing a short-lived ES256 token on your server. Snippets for Node, Python, Ruby, PHP, and Go.",
};

const loader = `${WIDGET_ORIGIN}/widget/v1/loader.js`;

const anonymous = `<script src="${loader}" data-widget="wid_your_widget_id" async></script>`;

const keys = `# Private key (P-256, PKCS8): keep it on your server, never in the browser.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out docent-private.pem

# Public key: add this one to your widget in Docent.
openssl pkey -in docent-private.pem -pubout -out docent-public.pem`;

const init = `<script>
  window.Docent=window.Docent||{q:[]};["init","open","close","reset"].forEach(function(m){Docent[m]=Docent[m]||function(){Docent.q.push([m,arguments])}});
  Docent.init({
    widget: "wid_your_widget_id",
    getToken: async () => {
      const response = await fetch("/docent-token");
      if (!response.ok) throw new Error("Not signed in");
      return response.text();
    },
  });
</script>
<script src="${loader}" async></script>`;

const csp = `Content-Security-Policy: script-src 'self' ${WIDGET_ORIGIN}; frame-src ${WIDGET_ORIGIN}`;

const reset = `// Before you sign the customer out, so the next person on this device starts fresh.
await Docent.reset();`;

const open = `// A "Contact support" button on your page.
Docent.open();

// Open the chat with a question already in the message field. The visitor
// reads it and presses Enter; the widget never sends it by itself.
// Text only, at most 1000 characters.
Docent.open({ prefill: "How do I export a note as a PDF?" });

Docent.close();`;

const claims: { name: string; required: string; value: ReactNode }[] = [
  { name: "alg (header)", required: "Yes", value: "ES256. Any other algorithm is rejected." },
  { name: "kid (header)", required: "Yes", value: "The key id Docent shows when you add the public key." },
  { name: "iss", required: "Yes", value: "Your widget id." },
  { name: "aud", required: "Yes", value: '"docent"' },
  { name: "sub", required: "Yes", value: "Your own id for the user, as a string of 1 to 255 characters." },
  { name: "iat", required: "Yes", value: "When you signed it, in seconds since 1970." },
  { name: "exp", required: "Yes", value: "When it expires: at most 15 minutes after iat." },
  { name: "jti", required: "Yes", value: "A unique id for this token. A reused jti is rejected." },
  { name: "name, email", required: "No", value: "Shown to your team when a conversation is handed off." },
  {
    name: "ctx",
    required: "No",
    value: "An object of custom fields you allow for the widget, such as plan. Each value is cut to 200 characters.",
  },
];

export default function DocsPage() {
  return (
    <>
      <PageIntro title="Install the widget">
        <p>
          Anonymous mode takes one script tag. Identified mode adds a small signing step on your server so Docent can
          answer for a signed-in customer.
        </p>
      </PageIntro>

      <Section
        id="anonymous"
        title="Anonymous mode"
        intro="Paste this before the closing body tag on every page that should show the widget. Docent answers from the sources you marked for everyone."
      >
        <CodeBlock label="HTML" code={anonymous} />
      </Section>

      <Section
        id="identified"
        title="Identified mode"
        intro="Use this when your customers log in. Your server proves who they are with a signed token; the browser only passes it along. Docent never reads your cookies or storage."
      >
        <ol className="flex flex-col gap-12">
          <Step number={1} title="Create a signing key">
            <p>
              Keep the private key on your server. Add the public key to your widget in Docent and note the key id it
              shows you.
            </p>
            <CodeBlock label="Terminal" code={keys} />
            <p>
              The examples below read three settings from your environment: <Env name="DOCENT_WIDGET_ID" />,{" "}
              <Env name="DOCENT_KEY_ID" />, and <Env name="DOCENT_PRIVATE_KEY" /> (the contents of the private key
              file).
            </p>
          </Step>
          <Step number={2} title="Sign a token for the logged-in user">
            <p>
              Return the token as plain text from a route that only logged-in users can reach. Keep the lifetime
              short; five minutes is plenty. Sign a new token on every request: each one works once.
            </p>
            <CodeTabs
              label="Signing examples"
              tabs={SIGNING_EXAMPLES.map((s) => ({ name: s.name, panel: <CodeBlock label={s.label} code={s.code} /> }))}
            />
          </Step>
          <Step number={3} title="Start the widget with the token">
            <p>
              The widget asks for a token when it opens and again when its 30 minute session needs renewing.
            </p>
            <CodeBlock label="HTML" code={init} />
          </Step>
          <Step number={4} title="Clear it on logout">
            <CodeBlock label="JavaScript" code={reset} />
          </Step>
        </ol>
      </Section>

      <Section
        id="open"
        title="Open the chat from your page"
        intro="Any page with the widget can open or close the chat, for example from a help link, and can open it with a question typed in for the visitor. To call these before loader.js has loaded, add the queue line that starts the identified-mode snippet; queued calls run once it arrives."
      >
        <CodeBlock label="JavaScript" code={open} />
      </Section>

      <Section
        id="csp"
        title="If your site has a Content Security Policy"
        intro="Allow the widget's origin for scripts and frames. The launcher brings its own styles and the chat runs inside the frame, so nothing else is needed. If you paste the identified-mode snippet inline, allow it the way you allow your other inline scripts, with a nonce or a hash."
      >
        <CodeBlock label="HTTP header" code={csp} />
      </Section>

      <Section id="claims" title="Token claims" intro="Docent checks every claim below before it starts a session.">
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-line text-sm text-ink-muted">
                <th scope="col" className="px-5 py-3 font-medium">
                  Claim
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Required
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.name} className="border-b border-line align-top last:border-b-0">
                  <th scope="row" className="px-5 py-3 font-mono text-sm font-normal whitespace-nowrap text-ink">
                    {claim.name}
                  </th>
                  <td className="px-5 py-3 text-ink-muted">{claim.required}</td>
                  <td className="px-5 py-3 text-ink">{claim.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 max-w-3xl text-base text-ink-muted">
          Docent also allows 60 seconds of clock difference, and starts a session only when the page showing the widget
          is on the list of domains you allowed for it.
        </p>
      </Section>
    </>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="grid gap-4 md:grid-cols-[2.5rem_minmax(0,1fr)]">
      <span
        aria-hidden="true"
        className="inline-flex size-8 items-center justify-center rounded-full border border-line-strong text-sm font-medium text-ink tabular-nums"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-col gap-4">
        <h3 className="text-lg text-ink">
          <span className="sr-only">Step {number}: </span>
          {title}
        </h3>
        <div className="flex min-w-0 flex-col gap-4 text-base text-ink-muted">{children}</div>
      </div>
    </li>
  );
}

function Env({ name }: { name: string }) {
  return <code className="font-mono text-sm text-ink">{name}</code>;
}

