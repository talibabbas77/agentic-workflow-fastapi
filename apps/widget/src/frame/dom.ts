// Tiny element builder. Text children become text nodes; there is no way to
// pass HTML through it.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | null | undefined>;

export type H = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
) => HTMLElementTagNameMap[K];

export function dom(doc: Document): H {
  return (tag, attrs, ...children) => {
    const el = doc.createElement(tag);
    if (attrs) {
      for (const [name, value] of Object.entries(attrs)) {
        if (value === true) el.setAttribute(name, "");
        else if (typeof value === "string") el.setAttribute(name, value);
      }
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(typeof child === "string" ? doc.createTextNode(child) : child);
    }
    return el;
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A 24x24 stroked icon. */
export function icon(doc: Document, d: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "ico");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

/** The Docent mark as drawn for small sizes (brand/docent-favicon.svg): ink bubble, rust ribbon. */
export function docentMark(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "mark");
  for (const [d, cls] of [
    ["M5.75 6.63H16.75A9.5 9.5 0 0 1 16.75 25.63H10.5L5.75 30.38Z", "mark-b"],
    ["M9.75 1.63H14.75V16.5L12.25 14L9.75 16.5Z", "mark-r"],
  ]) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", cls);
    svg.appendChild(path);
  }
  return svg;
}
