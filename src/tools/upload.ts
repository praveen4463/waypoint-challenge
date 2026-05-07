import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ParsedIepInputSchema } from "../types/iep.js";
import { ParsedLessonInputSchema } from "../types/lesson.js";
import { stampIepIds, stampLessonIds } from "../utils/ids.js";
import { saveIep } from "../storage/iep.js";
import { saveLesson } from "../storage/lessons.js";
import { MODIFICATION_RULES } from "../instructions.js";

const UPLOAD_IEP_DESCRIPTION = `
Stores a student's Individualized Education Program (IEP) in Waypoint's
registry. Call this whenever the user attaches an IEP file to the
conversation, pastes IEP content, or asks to begin working with a new
student. Required before generating modifications or logging progress
for that student.

WHAT TO DO
Read the attached IEP PDF (or pasted IEP text). Extract its content into
the structured 'parsed' fields below. The schema covers the standard
IEP sections — meta, concerns, present levels, profile, accommodations,
modifications, and goals.

EXTRACTION RULES
- Preserve text VERBATIM from the IEP — do not summarize, condense, or
  paraphrase. Use the source's exact wording.
- Skip legal/admin boilerplate (Notice of Proposed Action, signatures,
  Procedural Safeguards, Placement Consent Form). Focus on
  student-facing content: meta, concerns, present levels, profile,
  accommodations, modifications, goals.
- For each accommodation cell in the table, list each accommodation as
  a separate item under the appropriate column
  (presentation_of_instruction / response / timing_and_scheduling /
  setting_and_environment) and context (Classroom / Non-Academic
  Settings / Extracurricular Activities / Community/Workplace).
- For each goal: extract baseline, annual_target (target / criteria /
  method / schedule / person_responsible), the list of benchmarks
  (one per Short-term objective), and progress_reporting.
- Item IDs (acc-..., bench-..., goal-...) are stamped by the server —
  you do not need to provide them.

CANONICAL SHAPE (HARD RULE)
The response includes a 'parsed' field — that is the canonical stored
IEP, with server-stamped IDs. For all subsequent reasoning, citation,
and modification work in this conversation:
- ALWAYS use the response 'parsed' field as the single source of truth
  — for reading, reasoning, citation, displaying to the user, and any
  downstream tool calls.
- DO NOT use the input you just constructed for any purpose after this
  call returns — it has no IDs and is not what's stored.
- If you need to re-read the IEP later, call find_student rather than
  relying on memory of the original PDF.
`.trim();

const UPLOAD_LESSON_DESCRIPTION = `
Stores a lesson plan in Waypoint's registry. Call this whenever the
user attaches a lesson file or pastes lesson content. Required before
generating modifications for the lesson.

WHAT TO DO
Read the attached lesson PDF (or pasted text). Extract into the
structured fields below.

EXTRACTION RULES
- Preserve text VERBATIM. Do not summarize or paraphrase prompts.
- Use the lesson's [N] markers for paragraph numbers, the
  Paragraphs X-Y section markers for DRQ paragraph_range, the lettered
  prefix (A./B./*B./C.) for DRQ letter (uppercase) and optional flag
  (asterisk = optional).
- For MCQs: include the standard tag if present (e.g., "RI.6"); list
  options with letter A/B/C/D and full option text.
- For discussion_questions: numbered 1, 2, 3.
- Item IDs (p1, drq_p1_2_a, mcq_1, mcq_1_A, short_response_1,
  discussion_q1, vocab-01) are stamped by the server.

CANONICAL SHAPE (HARD RULE)
The response includes a 'parsed' field — that is the canonical stored
lesson, with server-stamped IDs. For all subsequent reasoning,
citation, and modification work in this conversation:
- ALWAYS use the response 'parsed' field as the single source of truth
  — for reading, reasoning, citation, displaying to the user, and any
  downstream tool calls.
- DO NOT use the input you just constructed for any purpose after this
  call returns — it has no IDs and is not what's stored.
- If you need to re-read the lesson later, call find_lesson rather
  than relying on memory of the original PDF.
`.trim();

export function registerUploadTools(server: McpServer): void {
  server.registerTool(
    "upload_iep",
    {
      title: "Upload an IEP",
      description: UPLOAD_IEP_DESCRIPTION,
      inputSchema: ParsedIepInputSchema.shape,
    },
    async (input) => {
      const parsed = stampIepIds(input);
      const stored = saveIep(
        parsed.meta.student_name,
        parsed as unknown as Record<string, unknown>,
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "ok",
                student_slug: stored.slug,
                student_name: stored.student_name,
                uploaded_at: stored.uploaded_at,
                parsed,
                parse_quality: summarizeIep(parsed),
                rules: MODIFICATION_RULES,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "upload_lesson",
    {
      title: "Upload a Lesson",
      description: UPLOAD_LESSON_DESCRIPTION,
      inputSchema: ParsedLessonInputSchema.shape,
    },
    async (input) => {
      const parsed = stampLessonIds(input);
      const stored = saveLesson(
        parsed.meta.title,
        parsed as unknown as Record<string, unknown>,
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "ok",
                lesson_slug: stored.slug,
                lesson_title: stored.title,
                uploaded_at: stored.uploaded_at,
                parsed,
                parse_quality: summarizeLesson(parsed),
                rules: MODIFICATION_RULES,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

function summarizeIep(p: ReturnType<typeof stampIepIds>) {
  return {
    concerns_captured: !!p.concerns,
    present_levels: Object.fromEntries(
      Object.entries(p.present_levels).map(([k, v]) => [
        k,
        v
          ? {
              current_performance_chars: v.current_performance.length,
              strengths_chars: v.strengths.length,
              impact_chars: v.impact_of_disability.length,
            }
          : null,
      ]),
    ),
    accommodations: p.accommodations
      ? Object.fromEntries(
          Object.entries(p.accommodations).map(([n, c]) => [
            n,
            {
              presentation_of_instruction: c.presentation_of_instruction.length,
              response: c.response.length,
              timing_and_scheduling: c.timing_and_scheduling.length,
              setting_and_environment: c.setting_and_environment.length,
              total:
                c.presentation_of_instruction.length +
                c.response.length +
                c.timing_and_scheduling.length +
                c.setting_and_environment.length,
            },
          ]),
        )
      : null,
    modifications: p.modifications
      ? Object.fromEntries(
          Object.entries(p.modifications).map(([n, c]) => [
            n,
            {
              content: c.content.length,
              instruction: c.instruction.length,
              student_output: c.student_output.length,
              total: c.content.length + c.instruction.length + c.student_output.length,
            },
          ]),
        )
      : null,
    goals: p.goals.map((g) => ({
      id: g.id,
      area: g.area,
      baseline_chars: g.baseline.length,
      annual_target_fields_present: {
        target: !!g.annual_target.target,
        criteria: !!g.annual_target.criteria,
        method: !!g.annual_target.method,
        schedule: !!g.annual_target.schedule,
        person_responsible: !!g.annual_target.person_responsible,
      },
      benchmark_count: g.benchmarks.length,
      progress_reporting_present: !!g.progress_reporting,
    })),
  };
}

function summarizeLesson(p: ReturnType<typeof stampLessonIds>) {
  return {
    vocabulary: p.vocabulary.length,
    paragraphs: p.paragraphs.length,
    drqs: p.drqs.length,
    mcqs_total: p.mcqs.length,
    mcqs_with_4_options: p.mcqs.filter((m) => m.options.length === 4).length,
    short_response: p.short_response ? 1 : 0,
    discussion_questions: p.discussion_questions.length,
  };
}
