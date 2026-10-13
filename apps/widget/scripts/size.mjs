#!/usr/bin/env node
// Prints raw and gzip sizes of the built widget files and fails if loader.js
// is over its budget. Run after `pnpm build`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const LOADER_GZIP_BUDGET = 6144;
const files = ["loader.js", "frame.js", "frame.css"];

const fmt = (n) => `${n.toLocaleString("en-US")} B (${(n / 1024).toFixed(2)} KB)`;

let failed = false;
console.log("file".padEnd(12), "raw".padEnd(24), "gzip");
for (const name of files) {
  let buf;
  try {
    buf = readFileSync(join(dist, name));
  } catch {
    console.error(`${name} is missing. Run \`pnpm build\` first.`);
    failed = true;
    continue;
  }
  const gz = gzipSync(buf, { level: 9 }).length;
  console.log(name.padEnd(12), fmt(buf.length).padEnd(24), fmt(gz));
  if (name === "loader.js" && gz > LOADER_GZIP_BUDGET) {
    console.error(`loader.js is ${gz} bytes gzipped, over the ${LOADER_GZIP_BUDGET} byte budget.`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`loader.js is within the ${LOADER_GZIP_BUDGET} byte gzip budget.`);
