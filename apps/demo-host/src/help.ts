// Lumen Notes' help center: the same Markdown articles the seed teaches the
// agent (fixtures/golden/lumen-notes), so every citation in the chat points at
// a section a visitor can open here. Articles only signed-in customers may see
// (questions.json "identified_only") are left out of this public site.
//
// The renderer covers the subset the articles use: headings, paragraphs,
// lists (one nested level), tables, **bold**, and `code`. Text is escaped first.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { escape } from "./html.ts";

const HELP_DIR =
  process.env.LUMEN_HELP_DIR ?? fileURLToPath(new URL("../../../fixtures/golden/lumen-notes/", import.meta.url));

export interface Section {
  id: string;
  title: string;
  level: 2 | 3;
  /** Plain text of the section body, for search snippets. */
  text: string;
}

export interface Article {
  slug: string;
  title: string;
  /** The first sentence of the introduction. */
  summary: string;
  sections: Section[];
  /** Rendered body, without the title. */
  body: string;
}

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function inline(text: string): string {
  // Odd segments sit between backticks: code, never formatted further.
  return text
    .split("`")
    .map((part, i) =>
      i % 2 ? `<code>${escape(part)}</code>` : escape(part).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
    )
    .join("");
}

const plain = (text: string): string => text.replace(/\*\*|`/g, "");

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

function table(rows: string[], label: string): string {
  const [head = "", , ...body] = rows;
  const th = cells(head)
    .map((cell) => (cell ? `<th scope="col">${inline(cell)}</th>` : `<td></td>`))
    .join("");
  const tr = body.map((row) => `<tr>${cells(row).map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("");
  // Focusable, so a keyboard can scroll a wide table on a small screen.
  return `<div class="table-wrap" role="region" aria-label="${escape(label)}" tabindex="0"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function list(lines: string[]): string {
  const ordered = /^\d+\./.test(lines[0]?.trim() ?? "");
  const items: { text: string; children: string[] }[] = [];
  for (const line of lines) {
    const nested = /^\s{2,}/.test(line);
    const text = line.trim().replace(/^(?:-|\d+\.)\s+/, "");
    const last = items.at(-1);
    if (nested && last) last.children.push(text);
    else items.push({ text, children: [] });
  }
  const tag = ordered ? "ol" : "ul";
  const li = items
    .map(
      ({ text, children }) =>
        `<li>${inline(text)}${children.length ? `<ul>${children.map((c) => `<li>${inline(c)}</li>`).join("")}</ul>` : ""}</li>`,
    )
    .join("");
  return `<${tag}>${li}</${tag}>`;
}

export function parseArticle(slug: string, markdown: string): Article {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let title = slug;
  let summary = "";
  const sections: Section[] = [];
  const out: string[] = [];
  let i = 0;
  const addText = (text: string): void => {
    const current = sections.at(-1);
    if (current) current.text += `${current.text ? " " : ""}${plain(text)}`;
    else if (!summary) summary = plain(text).split(/(?<=\.)\s/)[0] ?? "";
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line.trim()) {
      i++;
    } else if (heading) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2]?.trim() ?? "";
      if (level === 1) title = text;
      else {
        const id = slugify(text);
        sections.push({ id, title: text, level: level as 2 | 3, text: "" });
        out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      }
      i++;
    } else if (line.trimStart().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]?.trimStart().startsWith("|")) rows.push(lines[i++] ?? "");
      const count = out.filter((block) => block.startsWith("<div class=\"table-wrap\"")).length;
      out.push(table(rows, `Table ${count + 1}: ${sections.at(-1)?.title ?? title}`));
      addText(rows.filter((_, n) => n !== 1).map((row) => cells(row).join(" ")).join(" "));
    } else if (/^\s*(?:-|\d+\.)\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*(?:-|\d+\.)\s/.test(lines[i] ?? "")) items.push(lines[i++] ?? "");
      out.push(list(items));
      addText(items.map((item) => item.trim().replace(/^(?:-|\d+\.)\s+/, "")).join(" "));
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]?.trim() && !/^(#|\||\s*(?:-|\d+\.)\s)/.test(lines[i] ?? "")) {
        para.push((lines[i++] ?? "").trim());
      }
      const text = para.join(" ");
      out.push(`<p>${inline(text)}</p>`);
      addText(text);
    }
  }
  return { slug, title, summary, sections, body: out.join("\n") };
}

let cache: Promise<Article[]> | undefined;

/** Every public article, read once and kept in memory. */
export function articles(): Promise<Article[]> {
  cache ??= (async () => {
    let hidden = new Set<string>();
    try {
      const questions = JSON.parse(await readFile(join(HELP_DIR, "questions.json"), "utf8")) as {
        identified_only?: string[];
      };
      hidden = new Set(questions.identified_only ?? []);
    } catch {
      // No questions file: every article is public.
    }
    const names = (await readdir(HELP_DIR)).filter((name) => name.endsWith(".md") && !hidden.has(name));
    return Promise.all(
      names.map(async (name) => parseArticle(name.replace(/\.md$/, ""), await readFile(join(HELP_DIR, name), "utf8"))),
    );
  })();
  return cache;
}

export interface Hit {
  article: Article;
  section: Section | undefined;
  /** Escaped snippet with the matched words in <mark>. */
  snippet: string;
}

/** Sections whose title or text contain every word of the query, title matches first. */
export function search(all: Article[], query: string): Hit[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
  if (!words.length) return [];
  const scored: { hit: Hit; score: number }[] = [];
  for (const article of all) {
    for (const section of article.sections) {
      const title = `${article.title} ${section.title}`.toLowerCase();
      const body = section.text.toLowerCase();
      if (!words.every((word) => title.includes(word) || body.includes(word))) continue;
      const score = words.filter((word) => title.includes(word)).length;
      scored.push({ hit: { article, section, snippet: snippet(section.text, words) }, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ hit }) => hit);
}

function snippet(text: string, words: string[]): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const found = sentences.find((s) => words.some((word) => s.toLowerCase().includes(word))) ?? sentences[0] ?? "";
  const short = found.length > 180 ? `${found.slice(0, 177).replace(/\s+\S*$/, "")}...` : found;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return short
    .split(pattern)
    .map((part, i) => (i % 2 ? `<mark>${escape(part)}</mark>` : escape(part)))
    .join("");
}
