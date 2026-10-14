// Safe renderer for agent answers. Builds DOM nodes only; text always lands in
// text nodes, so nothing in a reply is ever parsed as HTML.
//
// Supported: paragraphs (blank line), line breaks, bulleted ("- ", "* ") and
// numbered ("1. ") lists, **bold**, citation markers [n] (as small chips), and
// links, but only when the URL is one of the message's own citation URLs.
// Anything else stays plain text.
import type { Citation } from "./types";

/** Normalized http(s) URL, or null for anything else (javascript:, data:, relative, junk). */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

const sameUrl = (a: string): string => a.replace(/\/+$/, "");

/** Chip label, for example "Billing and refunds > Refunds". */
export function citationLabel(c: Citation): string {
  const title = (c.document_title || "").trim();
  const path = (c.heading_path || "").trim();
  if (!path) return title || "Source";
  if (!title || path === title || path.startsWith(`${title} > `)) return path;
  return `${title} > ${path}`;
}

// One alternation, tried left to right at each position:
//   1 bold   2,3 markdown link   4 citation marker   5 bare URL
// No lookbehind, so older Safari can parse it.
const TOKEN =
  /\*\*(\S(?:[^\n]*?\S)?)\*\*|\[([^[\]\n]{1,300})\]\((https?:\/\/[^\s()<>]+)\)|\[(\d{1,3})\]|(https?:\/\/[^\s<>()[\]"']+)/g;

export function renderContent(
  text: string,
  citations: readonly Citation[],
  doc: Document = document,
): DocumentFragment {
  const byMarker = new Map<number, Citation>();
  const allowed = new Set<string>();
  for (const c of citations) {
    byMarker.set(c.marker, c);
    const url = safeUrl(c.url);
    if (url) allowed.add(sameUrl(url));
  }

  const link = (parent: Node, raw: string, label: string): void => {
    const url = safeUrl(raw);
    if (!url || !allowed.has(sameUrl(url))) {
      parent.appendChild(doc.createTextNode(label));
      return;
    }
    const a = doc.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    parent.appendChild(a);
  };

  const inline = (parent: Node, source: string, allowBold: boolean): void => {
    const re = new RegExp(TOKEN.source, "g");
    let last = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      if (m[1] !== undefined && !allowBold) {
        // No nested bold: step past the "**" and keep scanning for markers and links.
        re.lastIndex = m.index + 2;
        continue;
      }
      if (m.index > last) parent.appendChild(doc.createTextNode(source.slice(last, m.index)));
      last = m.index + m[0].length;
      if (m[1] !== undefined) {
        const strong = doc.createElement("strong");
        inline(strong, m[1], false);
        parent.appendChild(strong);
      } else if (m[2] !== undefined && m[3] !== undefined) {
        link(parent, m[3], m[2]);
      } else if (m[4] !== undefined) {
        const n = Number(m[4]);
        const cite = byMarker.get(n);
        if (!cite) {
          parent.appendChild(doc.createTextNode(m[0]));
          continue;
        }
        const chip = doc.createElement("button");
        chip.type = "button";
        chip.className = "ref";
        chip.dataset.ref = String(n);
        chip.setAttribute("aria-label", `Source ${n}: ${citationLabel(cite)}`);
        chip.textContent = String(n);
        parent.appendChild(chip);
      } else if (m[5] !== undefined) {
        const trail = /[.,;:!?]+$/.exec(m[5]);
        const url = trail ? m[5].slice(0, trail.index) : m[5];
        link(parent, url, url);
        if (trail) parent.appendChild(doc.createTextNode(trail[0]));
      }
    }
    if (last < source.length) parent.appendChild(doc.createTextNode(source.slice(last)));
  };

  const frag = doc.createDocumentFragment();
  const paragraphs = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/);
  for (const para of paragraphs) {
    // Consecutive list lines become one list; other lines join into a paragraph.
    let p: HTMLElement | null = null;
    let list: HTMLElement | null = null;
    for (const line of para.split("\n")) {
      const bullet = BULLET.exec(line);
      const numbered = bullet ? null : NUMBERED.exec(line);
      if (bullet || numbered) {
        const kind = bullet ? "ul" : "ol";
        if (!list || list.tagName.toLowerCase() !== kind) {
          list = doc.createElement(kind);
          list.dir = "auto";
          const first = numbered ? Number(numbered[1]) : 1;
          if (first !== 1) list.setAttribute("start", String(first));
          frag.appendChild(list);
        }
        p = null;
        const li = doc.createElement("li");
        inline(li, (bullet ? bullet[1] : numbered?.[2]) ?? "", true);
        list.appendChild(li);
        continue;
      }
      list = null;
      if (!line.trim()) continue;
      if (p) {
        p.appendChild(doc.createElement("br"));
      } else {
        p = doc.createElement("p");
        p.dir = "auto";
        frag.appendChild(p);
      }
      inline(p, line, true);
    }
  }
  return frag;
}

const BULLET = /^[ \t]*[-*\u2022][ \t]+(.+)$/;
const NUMBERED = /^[ \t]*(\d{1,3})[.)][ \t]+(.+)$/;

/** A source excerpt as plain text: no heading marks, bold marks, link syntax, or list dashes. */
export function plainExcerpt(text: string): string {
  return String(text ?? "")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\*\*(\S(?:[^\n]*?\S)?)\*\*/g, "$1")
    .replace(/\[([^[\]\n]{1,300})\]\([^)\s]*\)/g, "$1")
    .replace(/^[ \t]*[-*][ \t]+/gm, "\u2022 ")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
