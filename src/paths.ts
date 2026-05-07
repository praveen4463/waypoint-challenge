import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== "/" && dir !== ".") {
    if (existsSync(resolve(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`project root not found walking up from ${startDir}`);
}

const HERE = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = findRoot(HERE);
export const DATA_DIR = resolve(REPO_ROOT, "data");
export const CURATED_DIR = resolve(DATA_DIR, "domain", "curated");
export const SERVER_INSTRUCTIONS = resolve(
  CURATED_DIR,
  "role",
  "server-instructions.md",
);
export const ROOT_CATALOG = resolve(CURATED_DIR, "catalog.json");
export const DB_DIR = resolve(REPO_ROOT, "file-system-db");
export const STUDENTS_DIR = resolve(DB_DIR, "indexed", "students");
export const LESSONS_DIR = resolve(DB_DIR, "indexed", "lessons");
