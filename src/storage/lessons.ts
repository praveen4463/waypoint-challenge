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

// `parsed` is loosely typed here; the lesson parser will tighten it later.
export type ParsedLesson = Record<string, unknown>;

export interface LessonRecord {
  slug: string;
  title: string;
  parsed: ParsedLesson;
  raw_text: string;
  uploaded_at: string;
}

export interface LessonSummary {
  slug: string;
  title: string;
  uploaded_at: string;
}

export function saveLesson(
  title: string,
  parsed: ParsedLesson,
  raw_text: string,
): LessonRecord {
  const slug = slugify(title);
  const dir = join(LESSONS_DIR, slug);
  mkdirSync(dir, { recursive: true });

  const record: LessonRecord = {
    slug,
    title,
    parsed,
    raw_text,
    uploaded_at: new Date().toISOString(),
  };

  const { raw_text: _omit, ...meta } = record;
  writeFileSync(join(dir, "lesson.json"), JSON.stringify(meta, null, 2));
  writeFileSync(join(dir, "lesson.raw.txt"), raw_text);

  return record;
}

export function getLesson(slug: string): LessonRecord | null {
  const dir = join(LESSONS_DIR, slug);
  if (!existsSync(dir)) return null;
  const meta = JSON.parse(
    readFileSync(join(dir, "lesson.json"), "utf8"),
  ) as Omit<LessonRecord, "raw_text">;
  const raw_text = readFileSync(join(dir, "lesson.raw.txt"), "utf8");
  return { ...meta, raw_text };
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
