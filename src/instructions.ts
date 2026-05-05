import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_PATH = resolve(
  __dirname,
  "..",
  "data",
  "domain",
  "curated",
  "role",
  "server-instructions.md",
);

export function loadInstructions(): string {
  const raw = readFileSync(INSTRUCTIONS_PATH, "utf8");
  return raw.replace(/^<!--[\s\S]*?-->\s*/m, "").trim();
}
