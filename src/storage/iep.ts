// File system persistence for IEP documents.
// Each student has a folder under file-system-db/indexed/students/<slug>/
// holding their IEP (parsed JSON) and (Phase 2) progress data.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { STUDENTS_DIR } from "../paths.js";
import { slugify } from "./slugify.js";

// `parsed` is loosely typed at this layer; the real type is ParsedIep
// from src/types/iep.ts. We store unknown to keep the storage module
// independent of the IEP shape.
export type ParsedIepShape = Record<string, unknown>;

export interface IepRecord {
  slug: string;
  student_name: string;
  parsed: ParsedIepShape;
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
): IepRecord {
  const slug = slugify(student_name);
  const dir = join(STUDENTS_DIR, slug);
  mkdirSync(dir, { recursive: true });

  const record: IepRecord = {
    slug,
    student_name,
    parsed,
    uploaded_at: new Date().toISOString(),
  };

  writeFileSync(join(dir, "iep.json"), JSON.stringify(record, null, 2));

  return record;
}

export function getIep(slug: string): IepRecord | null {
  const dir = join(STUDENTS_DIR, slug);
  if (!existsSync(dir)) return null;
  return JSON.parse(readFileSync(join(dir, "iep.json"), "utf8")) as IepRecord;
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
