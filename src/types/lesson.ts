/**
 * Lesson types and Zod schemas. Same dual-shape pattern as iep.ts:
 * input from Claude (no IDs) is validated; server stamps IDs and persists.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema (no IDs)
// ---------------------------------------------------------------------------

const VocabularyEntryInput = z.object({
  word: z.string().min(1),
  pronunciation: z.string().optional(),
});

const ParsedParagraphInput = z.object({
  number: z.number().int().min(1),
  text: z.string().min(1),
});

const ParsedDRQInput = z.object({
  paragraph_range: z.string().min(1),
  letter: z.string().regex(/^[A-Z]$/),
  modality: z.string().optional(),
  prompt: z.string().min(1),
  optional: z.boolean().default(false),
});

const MCQOptionInput = z.object({
  letter: z.string().regex(/^[A-D]$/),
  text: z.string().min(1),
});

const ParsedMCQInput = z.object({
  number: z.number().int().min(1),
  standard: z.string().optional(),
  prompt: z.string().min(1),
  options: z.array(MCQOptionInput).default([]),
});

const ParsedShortResponseInput = z.object({
  standard: z.string().optional(),
  prompt: z.string().min(1),
});

const ParsedDiscussionQuestionInput = z.object({
  number: z.number().int().min(1),
  prompt: z.string().min(1),
});

export const ParsedLessonInputSchema = z.object({
  meta: z.object({
    title: z.string().min(1),
    author: z.string().optional(),
    skill_standard: z.string().optional(),
    purpose: z.string().optional(),
  }),
  vocabulary: z.array(VocabularyEntryInput).default([]),
  paragraphs: z.array(ParsedParagraphInput).default([]),
  drqs: z.array(ParsedDRQInput).default([]),
  mcqs: z.array(ParsedMCQInput).default([]),
  short_response: ParsedShortResponseInput.optional(),
  discussion_questions: z.array(ParsedDiscussionQuestionInput).default([]),
});

export type ParsedLessonInput = z.infer<typeof ParsedLessonInputSchema>;

// ---------------------------------------------------------------------------
// Stored shape (with IDs)
// ---------------------------------------------------------------------------

export interface VocabularyEntry {
  id: string;
  word: string;
  pronunciation?: string;
}

export interface ParsedParagraph {
  id: string;
  number: number;
  text: string;
}

export interface ParsedDRQ {
  id: string;
  paragraph_range: string;
  letter: string;
  modality?: string;
  prompt: string;
  optional: boolean;
}

export interface MCQOption {
  id: string;
  letter: string;
  text: string;
}

export interface ParsedMCQ {
  id: string;
  number: number;
  standard?: string;
  prompt: string;
  options: MCQOption[];
}

export interface ParsedShortResponse {
  id: string;
  standard?: string;
  prompt: string;
}

export interface ParsedDiscussionQuestion {
  id: string;
  number: number;
  prompt: string;
}

export interface ParsedLessonMeta {
  title: string;
  author?: string;
  skill_standard?: string;
  purpose?: string;
}

export interface ParsedLesson {
  meta: ParsedLessonMeta;
  vocabulary: VocabularyEntry[];
  paragraphs: ParsedParagraph[];
  drqs: ParsedDRQ[];
  mcqs: ParsedMCQ[];
  short_response?: ParsedShortResponse;
  discussion_questions: ParsedDiscussionQuestion[];
}
