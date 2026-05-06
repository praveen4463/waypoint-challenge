// File system persistence for lessons.

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
const LESSONS_DIR = join(
  __dirname,
  "..",
  "..",
  "file-system-db",
  "indexed",
  "lessons",
);

export type ParsedLessonShape = Record<string, unknown>;

export interface LessonRecord {
  slug: string;
  title: string;
  parsed: ParsedLessonShape;
  uploaded_at: string;
}

export interface LessonSummary {
  slug: string;
  title: string;
  uploaded_at: string;
}

export function saveLesson(
  title: string,
  parsed: ParsedLessonShape,
  raw_text: string,
): LessonRecord {
  const slug = slugify(title);
  const dir = join(LESSONS_DIR, slug);
  mkdirSync(dir, { recursive: true });

  const record: LessonRecord = {
    slug,
    title,
    parsed,
    uploaded_at: new Date().toISOString(),
  };

  writeFileSync(join(dir, "lesson.json"), JSON.stringify(record, null, 2));
  writeFileSync(join(dir, "lesson.raw.txt"), raw_text);

  return record;
}

export function getLesson(slug: string): LessonRecord | null {
  const dir = join(LESSONS_DIR, slug);
  if (!existsSync(dir)) return null;
  return JSON.parse(readFileSync(join(dir, "lesson.json"), "utf8")) as LessonRecord;
}

/** On-demand accessor for raw lesson text. Used only by tools that need
 *  line-anchored quoting. */
export function getLessonRawText(slug: string): string | null {
  const file = join(LESSONS_DIR, slug, "lesson.raw.txt");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

export function listLessons(): LessonSummary[] {
  if (!existsSync(LESSONS_DIR)) return [];
  return readdirSync(LESSONS_DIR)
    .filter((entry) => {
      const full = join(LESSONS_DIR, entry);
      return statSync(full).isDirectory();
    })
    .map((slug) => {
      const meta = JSON.parse(
        readFileSync(join(LESSONS_DIR, slug, "lesson.json"), "utf8"),
      ) as { slug: string; title: string; uploaded_at: string };
      return {
        slug: meta.slug,
        title: meta.title,
        uploaded_at: meta.uploaded_at,
      };
    });
}

/**
 * Resolve a free-text hint to a stored lesson.
 */
export function findLessonByHint(hint: string): LessonRecord | null {
  const all = listLessons();
  if (all.length === 0) return null;

  const hintSlug = slugify(hint);
  if (!hintSlug) return null;

  let match = all.find((l) => l.slug === hintSlug);

  if (!match) {
    match = all.find(
      (l) => l.slug.includes(hintSlug) || hintSlug.includes(l.slug),
    );
  }

  if (!match) {
    const hintWords = hintSlug.split("-").filter((w) => w.length > 0);
    match = all.find((l) => {
      const slugWords = l.slug.split("-");
      return hintWords.some((hw) => slugWords.includes(hw));
    });
  }

  return match ? getLesson(match.slug) : null;
}
