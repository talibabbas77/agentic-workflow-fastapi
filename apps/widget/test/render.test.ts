import { describe, expect, it } from "vitest";
import { citationLabel, plainExcerpt, renderContent, safeUrl } from "../src/frame/render";
import type { Citation } from "../src/frame/types";

const cite = (marker: number, url: string | null = null): Citation => ({
  marker,
  document_title: "Billing and refunds",
  heading_path: "Refunds",
  url,
  excerpt: "Refunds take 5 days.",
});

function render(text: string, citations: Citation[] = []): HTMLDivElement {
  const div = document.createElement("div");
  div.appendChild(renderContent(text, citations, document));
  return div;
}

describe("safe renderer", () => {
  it("escapes HTML instead of parsing it", () => {
    const div = render('<img src=x onerror="alert(1)"><script>alert(2)</script> & <b>hi</b>');
    expect(div.querySelector("img, script, b")).toBeNull();
    expect(div.textContent).toBe('<img src=x onerror="alert(1)"><script>alert(2)</script> & <b>hi</b>');
    expect(div.innerHTML).toContain("&lt;img");
    expect(div.innerHTML).toContain("&lt;script&gt;");
  });

  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    const div = render("First line\nsecond line\n\nNew paragraph\r\n\r\nThird");
    const ps = div.querySelectorAll("p");
    expect(ps).toHaveLength(3);
    expect(ps[0].querySelectorAll("br")).toHaveLength(1);
    expect(ps[0].textContent).toBe("First linesecond line");
    expect(ps[1].textContent).toBe("New paragraph");
    expect(ps[0].getAttribute("dir")).toBe("auto");
  });

  it("renders **bold** without nesting and leaves stray asterisks alone", () => {
    const div = render("This is **important** and ** not bold ** and 2 ** 3");
    const strong = div.querySelectorAll("strong");
    expect(strong).toHaveLength(1);
    expect(strong[0].textContent).toBe("important");
    expect(div.textContent).toContain("** not bold **");
  });

  it("turns [n] into chips only for known citations", () => {
    const div = render("Refunds take 5 days [1]. See also [7].", [cite(1)]);
    const chips = div.querySelectorAll("button.ref");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("1");
    expect(chips[0].getAttribute("data-ref")).toBe("1");
    expect(chips[0].getAttribute("aria-label")).toBe("Source 1: Billing and refunds > Refunds");
    expect(div.textContent).toContain("[7]");
  });

  it("renders chips inside bold text", () => {
    const div = render("**Refunds take 5 days [1]**", [cite(1)]);
    expect(div.querySelector("strong button.ref")).not.toBeNull();
  });

  it("links only URLs that match a citation URL", () => {
    const div = render(
      "Read https://help.example.com/refunds/. Not https://evil.example.net/steal?x=1 or [click](https://evil.example.net).",
      [cite(1, "https://help.example.com/refunds")],
    );
    const links = div.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://help.example.com/refunds/");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0].getAttribute("target")).toBe("_blank");
    // Trailing punctuation stays outside the link.
    expect(links[0].textContent).toBe("https://help.example.com/refunds/");
    expect(div.textContent).toContain("https://evil.example.net/steal?x=1");
    // A markdown link to a non citation URL shows only its label.
    expect(div.textContent).toContain("or click.");
  });

  it("renders a markdown link with its label when the URL is a citation URL", () => {
    const div = render("See [the refunds page](https://help.example.com/refunds).", [
      cite(1, "https://help.example.com/refunds"),
    ]);
    const a = div.querySelector("a");
    expect(a?.textContent).toBe("the refunds page");
  });

  it("never links javascript: or data: URLs, even if a citation carries one", () => {
    const div = render("[x](javascript:alert(1)) javascript:alert(1) data:text/html,hi", [
      cite(1, "javascript:alert(1)"),
      cite(2, "data:text/html,hi"),
    ]);
    expect(div.querySelector("a")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,hi")).toBeNull();
    expect(safeUrl("/relative")).toBeNull();
    expect(safeUrl("https://ok.example.com/a")).toBe("https://ok.example.com/a");
  });

  it("handles empty and whitespace only input", () => {
    expect(render("").childNodes).toHaveLength(0);
    expect(render("  \n\n  ").childNodes).toHaveLength(0);
  });
});

describe("citationLabel", () => {
  it("joins title and heading path without repeating the title", () => {
    expect(citationLabel(cite(1))).toBe("Billing and refunds > Refunds");
    expect(citationLabel({ ...cite(1), heading_path: "Billing and refunds > Refunds" })).toBe(
      "Billing and refunds > Refunds",
    );
    expect(citationLabel({ ...cite(1), heading_path: "" })).toBe("Billing and refunds");
    expect(citationLabel({ ...cite(1), heading_path: "", document_title: "" })).toBe("Source");
  });

  it("renders bulleted and numbered lists, with text around them", () => {
    const div = render("Void windows by carrier:\n- Ridgeway: 30 days [1]\n- Kestrel: 24 hours\nAsk if unsure.\n\n3. Third\n4. Fourth", [cite(1)]);
    const [ul, ol] = [div.querySelector("ul"), div.querySelector("ol")];
    expect(div.querySelector("p")?.textContent).toBe("Void windows by carrier:");
    expect([...(ul?.querySelectorAll("li") ?? [])].map((li) => li.textContent)).toEqual(["Ridgeway: 30 days 1", "Kestrel: 24 hours"]);
    expect(ul?.querySelector("button.ref")).not.toBeNull();
    expect(div.querySelectorAll("p")[1]?.textContent).toBe("Ask if unsure.");
    expect(ol?.getAttribute("start")).toBe("3");
    expect(ol?.querySelectorAll("li")).toHaveLength(2);
  });

  it("keeps **bold** at the start of a line out of lists", () => {
    const div = render("**Note:** labels are PDFs");
    expect(div.querySelector("ul")).toBeNull();
    expect(div.querySelector("strong")?.textContent).toBe("Note:");
  });

  it("shows source excerpts as plain text", () => {
    expect(plainExcerpt("## Void windows\n\n- **Ridgeway**: 30 days\n- See [carriers](https://x.example/c)")).toBe(
      "Void windows \u2022 Ridgeway: 30 days \u2022 See carriers",
    );
  });
});
