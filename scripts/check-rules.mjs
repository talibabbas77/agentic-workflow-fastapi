#!/usr/bin/env node
// Enforces the copy and UI rules in CLAUDE.md across the repo:
//   no em or en dashes, no blue/green/purple colors, no shadows, no gradients,
//   and "teach the agent", never "train an LLM".
// Usage: node scripts/check-rules.mjs   (exit code 1 on any violation)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const TEXT_EXT = new Set([
  ".md", ".mdx", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".css", ".html", ".svg",
  ".py", ".sql", ".sh", ".yaml", ".yml", ".toml", ".json", ".txt", ".mako", ".ini", ".example",
]);
const STYLE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".html", ".svg"]);
const SKIP = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)dist\//,
  /(^|\/)playwright-report\//,
  /(^|\/)test-results\//,
  /pnpm-lock\.yaml$/,
  /uv\.lock$/,
  /\.d\.ts$/,
  /packages\/api-client\/openapi\.json$/,
  /scripts\/check-rules\.mjs$/,
];

const FORBIDDEN_FAMILIES =
  "blue|green|purple|indigo|violet|sky|cyan|teal|emerald|lime|fuchsia";
const TW_COLOR = new RegExp(
  `\\b(?:bg|text|border|fill|stroke|outline|decoration|from|to|via|accent|caret|divide|placeholder|ring)-(?:${FORBIDDEN_FAMILIES})-\\d{2,3}\\b`,
);
const CSS_NAMED = new RegExp(`:\\s*(?:${FORBIDDEN_FAMILIES}|navy|aqua|turquoise|olive)\\b\\s*[;!}]`, "i");
const SHADOW_CLASS = /(?<![\w-])(?:shadow|drop-shadow)(?:-(?!none\b)[\w\[\]./-]+)?(?![\w-])/;
const RING_CLASS = /(?<![\w-])ring(?:-(?:\d|offset|inset|[a-z]+-\d))[\w-]*/;
const BOX_SHADOW = /box-shadow\s*:\s*(?!none\b)/i;
const GRADIENT = /(?:linear|radial|conic)-gradient\(|\bbg-gradient-|\bbg-(?:linear|radial|conic)-/;
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function hueSat(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, sat };
}

function forbiddenHex(hex) {
  const { hue, sat } = hueSat(hex);
  // Green through blue to purple, with enough saturation to read as a color.
  return sat > 0.2 && hue >= 75 && hue <= 300;
}

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((f) => !SKIP.some((re) => re.test(f)))
  .filter((f) => TEXT_EXT.has(extname(f)) || f.endsWith(".env.example"));

const problems = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const isStyle = STYLE_EXT.has(extname(file));
  text.split("\n").forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    if (line.includes("—")) problems.push(`${at}: em dash`);
    if (line.includes("–")) problems.push(`${at}: en dash`);
    if (/train(?:ing)? an LLM/i.test(line) && !/teach the agent/i.test(line)) problems.push(`${at}: say "teach the agent"`);
    for (const hex of line.match(HEX) ?? []) {
      if (forbiddenHex(hex)) problems.push(`${at}: forbidden color ${hex}`);
    }
    if (!isStyle) return;
    if (TW_COLOR.test(line)) problems.push(`${at}: forbidden color class ${line.match(TW_COLOR)[0]}`);
    if (CSS_NAMED.test(line)) problems.push(`${at}: forbidden named color`);
    if (BOX_SHADOW.test(line)) problems.push(`${at}: box-shadow`);
    if (GRADIENT.test(line)) problems.push(`${at}: gradient`);
    if (/className|class=|clsx|cn\(|@apply/.test(line)) {
      const shadow = line.match(SHADOW_CLASS);
      if (shadow) problems.push(`${at}: shadow utility ${shadow[0]}`);
      const ring = line.match(RING_CLASS);
      if (ring) problems.push(`${at}: ring utility ${ring[0]} (use outline)`);
    }
  });
}

if (problems.length) {
  console.error(`Rule check failed (${problems.length}):\n` + problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Rule check passed (${files.length} files).`);
