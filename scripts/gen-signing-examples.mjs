// Copies the verified signing examples into the web app, so the install guide
// shows exactly the code that examples/signing/verify.sh runs against the API.
// Usage: node scripts/gen-signing-examples.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";

const EXAMPLES = [
  { name: "Node", label: "Node, with jose", file: "node.mjs" },
  { name: "Python", label: "Python, with PyJWT", file: "python.py" },
  { name: "Ruby", label: "Ruby, with the jwt gem", file: "ruby.rb" },
  { name: "PHP", label: "PHP, with firebase/php-jwt", file: "php.php" },
  { name: "Go", label: "Go, with golang-jwt", file: "go/main.go" },
];
const OUT = new URL("../apps/web/src/lib/signing-examples.ts", import.meta.url);

const entries = EXAMPLES.map(({ name, label, file }) => {
  const code = readFileSync(new URL(`../examples/signing/${file}`, import.meta.url), "utf8").trimEnd();
  return `  {\n    name: ${JSON.stringify(name)},\n    label: ${JSON.stringify(label)},\n    code: ${JSON.stringify(code)},\n  },`;
});
const source = `// Generated from examples/signing by scripts/gen-signing-examples.mjs. Do not edit.

export const SIGNING_EXAMPLES: { name: string; label: string; code: string }[] = [
${entries.join("\n")}
];
`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {}
  if (current !== source) {
    console.error("Signing examples are out of date. Run: node scripts/gen-signing-examples.mjs");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, source);
}
