/**
 * Stamps stable IDs onto validated tool input. Claude returns the natural
 * fields (paragraph numbers, item text, goal area names); the server
 * decides ID conventions so they're deterministic across uploads.
 */

import type {
  ParsedIep,
  ParsedIepInput,
  AccommodationContext,
  ModificationContext,
} from "../types/iep.js";
import type { ParsedLesson, ParsedLessonInput } from "../types/lesson.js";

function slugifyContext(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Returns an ID guaranteed to be unique within the given `seen` set.
 * On collision, appends `-dup${N}` and logs a warning to stderr — never
 * throws. Lets us preserve Claude's intent (the "natural" ID) when
 * possible while keeping every record uniquely addressable.
 */
function uniqueId(base: string, seen: Set<string>): string {
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let i = 2;
  while (seen.has(`${base}-dup${i}`)) i++;
  const next = `${base}-dup${i}`;
  seen.add(next);
  console.error(
    `[waypoint] duplicate id detected; renamed "${base}" -> "${next}"`,
  );
  return next;
}

// ---------------------------------------------------------------------------
// IEP — stamp IDs and descriptions
// ---------------------------------------------------------------------------

export function stampIepIds(input: ParsedIepInput): ParsedIep {
  const seen = new Set<string>();
  return {
    meta: input.meta,
    concerns: input.concerns
      ? { id: uniqueId("concerns", seen), text: input.concerns.text }
      : undefined,
    present_levels: {
      academics: input.present_levels.academics
        ? { id: uniqueId("pl-academics", seen), ...input.present_levels.academics }
        : undefined,
      behavioral: input.present_levels.behavioral
        ? { id: uniqueId("pl-behavioral", seen), ...input.present_levels.behavioral }
        : undefined,
      communication: input.present_levels.communication
        ? { id: uniqueId("pl-communication", seen), ...input.present_levels.communication }
        : undefined,
      additional_areas: input.present_levels.additional_areas
        ? { id: uniqueId("pl-additional-areas", seen), ...input.present_levels.additional_areas }
        : undefined,
    },
    profile: input.profile,
    accommodations: input.accommodations
      ? stampAccommodationContexts(input.accommodations, seen)
      : undefined,
    modifications: input.modifications
      ? stampModificationContexts(input.modifications, seen)
      : undefined,
    goals: input.goals.map((g) => ({
      id: uniqueId(`goal-${g.number}`, seen),
      number: g.number,
      area: g.area,
      baseline: g.baseline,
      annual_target: g.annual_target,
      benchmarks: g.benchmarks.map((b, i) => ({
        id: uniqueId(`bench-${g.number}-${pad2(i + 1)}`, seen),
        text: b.text,
      })),
      progress_reporting: g.progress_reporting,
    })),
  };
}

function stampAccommodationContexts(
  contexts: NonNullable<ParsedIepInput["accommodations"]>,
  seen: Set<string>,
): Record<string, AccommodationContext> {
  const out: Record<string, AccommodationContext> = {};
  for (const [name, ctx] of Object.entries(contexts)) {
    const slug = slugifyContext(name);
    out[name] = {
      presentation_of_instruction: ctx.presentation_of_instruction.map((it, i) => ({
        id: uniqueId(`acc-presentation-of-instruction-${slug}-${pad2(i + 1)}`, seen),
        text: it.text,
      })),
      response: ctx.response.map((it, i) => ({
        id: uniqueId(`acc-response-${slug}-${pad2(i + 1)}`, seen),
        text: it.text,
      })),
      timing_and_scheduling: ctx.timing_and_scheduling.map((it, i) => ({
        id: uniqueId(`acc-timing-and-scheduling-${slug}-${pad2(i + 1)}`, seen),
        text: it.text,
      })),
      setting_and_environment: ctx.setting_and_environment.map((it, i) => ({
        id: uniqueId(`acc-setting-and-environment-${slug}-${pad2(i + 1)}`, seen),
        text: it.text,
      })),
    };
  }
  return out;
}

function stampModificationContexts(
  contexts: NonNullable<ParsedIepInput["modifications"]>,
  seen: Set<string>,
): Record<string, ModificationContext> {
  const out: Record<string, ModificationContext> = {};
  for (const [name, ctx] of Object.entries(contexts)) {
    const slug = slugifyContext(name);
    out[name] = {
      content: ctx.content.map((it, i) => ({
        id: uniqueId(`mod-content-${slug}-${pad2(i + 1)}`, seen),
        text: it.text,
      })),
      instruction: ctx.instruction.map((it, i) => ({
        id: uniqueId(`mod-instruction-${slug}-${pad2(i + 1)}`, seen),
        text: it.text,
      })),
      student_output: ctx.student_output.map((it, i) => ({
        id: uniqueId(`mod-student-output-${slug}-${pad2(i + 1)}`, seen),
        text: it.text,
      })),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lesson — stamp IDs
// ---------------------------------------------------------------------------

export function stampLessonIds(input: ParsedLessonInput): ParsedLesson {
  const seen = new Set<string>();
  return {
    meta: input.meta,
    vocabulary: input.vocabulary.map((v, i) => ({
      id: uniqueId(`vocab-${pad2(i + 1)}`, seen),
      word: v.word,
      pronunciation: v.pronunciation,
    })),
    paragraphs: input.paragraphs.map((p) => ({
      id: uniqueId(`p${p.number}`, seen),
      number: p.number,
      text: p.text,
    })),
    drqs: input.drqs.map((d) => ({
      id: uniqueId(
        `drq_p${d.paragraph_range.replace(/[-–]/g, "_")}_${d.letter.toLowerCase()}`,
        seen,
      ),
      paragraph_range: d.paragraph_range,
      letter: d.letter,
      modality: d.modality,
      prompt: d.prompt,
      optional: d.optional,
    })),
    mcqs: input.mcqs.map((m) => ({
      id: uniqueId(`mcq_${m.number}`, seen),
      number: m.number,
      standard: m.standard,
      prompt: m.prompt,
      options: m.options.map((o) => ({
        id: uniqueId(`mcq_${m.number}_${o.letter}`, seen),
        letter: o.letter,
        text: o.text,
      })),
    })),
    short_response: input.short_response
      ? {
          id: uniqueId("short_response_1", seen),
          standard: input.short_response.standard,
          prompt: input.short_response.prompt,
        }
      : undefined,
    discussion_questions: input.discussion_questions.map((q) => ({
      id: uniqueId(`discussion_q${q.number}`, seen),
      number: q.number,
      prompt: q.prompt,
    })),
  };
}
