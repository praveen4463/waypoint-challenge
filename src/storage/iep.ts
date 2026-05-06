// File system persistence for IEP documents (parsed + raw + diagnostics).
// Each student has a folder under file-system-db/indexed/students/<slug>/
// holding their IEP and (Phase 2) progress data.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "./slugify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUDENTS_DIR = join(
  __dirname,
  "..",
  "..",
  "file-system-db",
  "indexed",
  "students",
);

// `parsed` is loosely typed here; the IEP parser provides the real shape.
export type ParsedIepShape = Record<string, unknown>;

export interface IepRecord {
  slug: string;
  student_name: string;
  parsed: ParsedIepShape;
  raw_text: string;
  uploaded_at: string;
}

export interface IepSummary {
  slug: string;
  student_name: string;
  uploaded_at: string;
}

export function saveIep(
  student_name: string,
  parsed: ParsedIepShape,
  raw_text: string,
): IepRecord {
  const slug = slugify(student_name);
  const dir = join(STUDENTS_DIR, slug);
  mkdirSync(dir, { recursive: true });

  const record: IepRecord = {
    slug,
    student_name,
    parsed,
    raw_text,
    uploaded_at: new Date().toISOString(),
  };

  // Persist parsed JSON without the raw text (raw lives in the .txt file).
  const { raw_text: _omit, ...meta } = record;
  writeFileSync(join(dir, "iep.json"), JSON.stringify(meta, null, 2));
  writeFileSync(join(dir, "iep.raw.txt"), raw_text);

  return record;
}

export function getIep(slug: string): IepRecord | null {
  const dir = join(STUDENTS_DIR, slug);
  if (!existsSync(dir)) return null;
  const meta = JSON.parse(readFileSync(join(dir, "iep.json"), "utf8")) as Omit<
    IepRecord,
    "raw_text"
  >;
  const raw_text = readFileSync(join(dir, "iep.raw.txt"), "utf8");
  return { ...meta, raw_text };
}

export function listIeps(): IepSummary[] {
  if (!existsSync(STUDENTS_DIR)) return [];
  return readdirSync(STUDENTS_DIR)
    .filter((entry) => {
      const full = join(STUDENTS_DIR, entry);
      return statSync(full).isDirectory();
    })
    .map((slug) => {
      const meta = JSON.parse(
        readFileSync(join(STUDENTS_DIR, slug, "iep.json"), "utf8"),
      ) as { slug: string; student_name: string; uploaded_at: string };
      return {
        slug: meta.slug,
        student_name: meta.student_name,
        uploaded_at: meta.uploaded_at,
      };
    });
}

/**
 * Resolve a free-text hint (e.g., a project name like "Jasmine Bailey",
 * or just "jasmine") to a stored IEP. Returns the full record or null.
 *
 * Matching strategy, most-specific to least:
 *   1. Exact slug match.
 *   2. Substring containment in either direction.
 *   3. Any word overlap.
 */
export function findIepByStudent(hint: string): IepRecord | null {
  const all = listIeps();
  if (all.length === 0) return null;

  const hintSlug = slugify(hint);
  if (!hintSlug) return null;

  let match = all.find((s) => s.slug === hintSlug);

  if (!match) {
    match = all.find(
      (s) => s.slug.includes(hintSlug) || hintSlug.includes(s.slug),
    );
  }

  if (!match) {
    const hintWords = hintSlug.split("-").filter((w) => w.length > 0);
    match = all.find((s) => {
      const slugWords = s.slug.split("-");
      return hintWords.some((hw) => slugWords.includes(hw));
    });
  }

  return match ? getIep(match.slug) : null;
}
