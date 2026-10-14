// A tiny HTML template tag. Every interpolated value is escaped unless it is
// already Html (the result of another html`` call or raw()), so data such as a
// persona's name can never become markup.

export class Html {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

type Part = string | number | Html | Part[] | null | undefined | false;

export const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Trusted markup, for example inline SVG written in this codebase. */
export const raw = (value: string): Html => new Html(value);

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return "";
  if (Array.isArray(part)) return part.map(render).join("");
  if (part instanceof Html) return part.value;
  return escape(String(part));
}

export function html(strings: TemplateStringsArray, ...parts: Part[]): Html {
  let out = strings[0] ?? "";
  parts.forEach((part, i) => {
    out += render(part) + (strings[i + 1] ?? "");
  });
  return new Html(out);
}
