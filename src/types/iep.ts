/**
 * IEP types and Zod schemas. Source of truth for both:
 *   - The structured shape Claude returns when uploading an IEP via the
 *     `upload_iep` tool (validated by Zod at the tool boundary).
 *   - The shape stored on disk and returned to Claude on subsequent
 *     `find_student` / `get_iep` calls (after the server stamps IDs).
 *
 * Claude provides natural fields (paragraph numbers, accommodation text,
 * goal numbers). The server stamps stable IDs (acc-..., bench-..., etc.)
 * after validation so we don't depend on Claude remembering ID conventions.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema (what Claude sends — no IDs)
// ---------------------------------------------------------------------------

const AccommodationItemInput = z.object({
  text: z.string().min(1),
});

const ModificationItemInput = z.object({
  text: z.string().min(1),
});

const BenchmarkItemInput = z.object({
  text: z.string().min(1),
});

const AccommodationContextInput = z.object({
  description: z.string().optional(),
  presentation_of_instruction: z.array(AccommodationItemInput).default([]),
  response: z.array(AccommodationItemInput).default([]),
  timing_and_scheduling: z.array(AccommodationItemInput).default([]),
  setting_and_environment: z.array(AccommodationItemInput).default([]),
});

const ModificationContextInput = z.object({
  description: z.string().optional(),
  content: z.array(ModificationItemInput).default([]),
  instruction: z.array(ModificationItemInput).default([]),
  student_output: z.array(ModificationItemInput).default([]),
});

const PresentLevelEntryInput = z.object({
  header_text: z.string(),
  current_performance: z.string().default(""),
  strengths: z.string().default(""),
  impact_of_disability: z.string().default(""),
});

const GoalAnnualTargetInput = z.object({
  target: z.string().optional(),
  criteria: z.string().optional(),
  method: z.string().optional(),
  schedule: z.string().optional(),
  person_responsible: z.string().optional(),
});

const ParsedGoalInput = z.object({
  number: z.number().int().min(1),
  area: z.string().min(1),
  baseline: z.string().default(""),
  annual_target: GoalAnnualTargetInput.default({}),
  benchmarks: z.array(BenchmarkItemInput).default([]),
  progress_reporting: z.string().optional(),
});

export const ParsedIepInputSchema = z.object({
  meta: z.object({
    student_name: z.string().min(1),
    grade: z.string().optional(),
    dob: z.string().optional(),
    sasid: z.string().optional(),
    case_manager: z.string().optional(),
    school: z.string().optional(),
    iep_dates: z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .optional(),
  }),
  concerns: z
    .object({
      text: z.string(),
    })
    .optional(),
  present_levels: z.object({
    academics: PresentLevelEntryInput.optional(),
    behavioral: PresentLevelEntryInput.optional(),
    communication: PresentLevelEntryInput.optional(),
    additional_areas: PresentLevelEntryInput.optional(),
  }),
  profile: z.object({
    disability_categories: z.array(z.string()).default([]),
    is_english_learner: z.boolean().default(false),
    requires_at: z.boolean().default(false),
    at_notes: z.string().optional(),
  }),
  accommodations: z.record(z.string(), AccommodationContextInput).optional(),
  modifications: z.record(z.string(), ModificationContextInput).optional(),
  goals: z.array(ParsedGoalInput).default([]),
});

export type ParsedIepInput = z.infer<typeof ParsedIepInputSchema>;

// ---------------------------------------------------------------------------
// Stored shape (what we persist — with IDs)
// ---------------------------------------------------------------------------

export interface AccommodationItem {
  id: string;
  text: string;
}

export interface ModificationItem {
  id: string;
  text: string;
}

export interface BenchmarkItem {
  id: string;
  text: string;
}

export interface AccommodationContext {
  presentation_of_instruction: AccommodationItem[];
  response: AccommodationItem[];
  timing_and_scheduling: AccommodationItem[];
  setting_and_environment: AccommodationItem[];
}

export interface ModificationContext {
  content: ModificationItem[];
  instruction: ModificationItem[];
  student_output: ModificationItem[];
}

export interface PresentLevelEntry {
  header_text: string;
  current_performance: string;
  strengths: string;
  impact_of_disability: string;
}

export type PresentLevelKey =
  | "academics"
  | "behavioral"
  | "communication"
  | "additional_areas";

export type PresentLevelsBlock = Partial<Record<PresentLevelKey, PresentLevelEntry>>;

export interface ConcernsBlock {
  text: string;
}

export interface ParsedMeta {
  student_name: string;
  grade?: string;
  dob?: string;
  sasid?: string;
  case_manager?: string;
  school?: string;
  iep_dates?: { from?: string; to?: string };
}

export interface ParsedProfile {
  disability_categories: string[];
  is_english_learner: boolean;
  requires_at: boolean;
  at_notes?: string;
}

export interface GoalAnnualTarget {
  target?: string;
  criteria?: string;
  method?: string;
  schedule?: string;
  person_responsible?: string;
}

export interface ParsedGoal {
  id: string;
  number: number;
  area: string;
  baseline: string;
  annual_target: GoalAnnualTarget;
  benchmarks: BenchmarkItem[];
  progress_reporting?: string;
}

export interface ParsedIep {
  meta: ParsedMeta;
  concerns?: ConcernsBlock;
  present_levels: PresentLevelsBlock;
  profile: ParsedProfile;
  accommodations?: Record<string, AccommodationContext>;
  modifications?: Record<string, ModificationContext>;
  goals: ParsedGoal[];
}
