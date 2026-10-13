/** Read emails the API sent, from Mailpit's HTTP API. */
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

type Summary = { ID: string; Subject: string; To: { Address: string }[] };

async function search(to: string): Promise<Summary[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  const body = (await response.json()) as { messages: Summary[] };
  return body.messages;
}

/** Wait for an email to `to` that contains a link with `pathPrefix`, and return that link. */
export async function waitForLink(to: string, pathPrefix: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const pattern = new RegExp(`https?://[^\\s"'<>]+${pathPrefix.replace(/[?]/g, "\\?")}[^\\s"'<>]+`);
  while (Date.now() < deadline) {
    for (const message of await search(to)) {
      const response = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`);
      const full = (await response.json()) as { Text?: string; HTML?: string };
      const match = `${full.Text ?? ""}\n${full.HTML ?? ""}`.match(pattern);
      if (match) return match[0].replace(/&amp;/g, "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email to ${to} with a ${pathPrefix} link within ${timeoutMs}ms`);
}

export function uniqueEmail(label: string) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${label}-${id}@example.com`;
}
