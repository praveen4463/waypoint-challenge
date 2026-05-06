import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseIep } from "../parsers/iep.js";
import { saveIep } from "../storage/iep.js";
import { parseLesson } from "../parsers/lesson.js";
import { saveLesson } from "../storage/lessons.js";

const UPLOAD_IEP_DESCRIPTION = `
Stores a student's Individualized Education Program (IEP) in Waypoint's
registry under the student's name. Call this whenever the user attaches
an IEP file to the conversation, pastes IEP content, or asks to begin
working with a new student. Required before generating modifications or
logging progress for that student.

INPUT
The 'content' parameter must be the full extracted text of the IEP
document. Pass it verbatim — do not summarize, condense, or reformat.
Preserve original line breaks and section headers as they appear.

RESPONSE — IMPORTANT
The response contains a 'parsed' field with the canonical structured
view of the IEP: meta, profile, concerns, present_levels (academics,
behavioral, communication, additional_areas), accommodations
(contexts × columns, with stable item IDs like
'acc-timing-and-scheduling-classroom-02'), modifications (same shape),
and goals (each with structured annual_target fields and benchmarks
with stable IDs like 'bench-3-03').

ALWAYS use 'parsed' as the source of truth for any subsequent
reasoning, citation, or modification work. Do NOT re-derive accommodation
text, goal benchmarks, or section content from the raw IEP text you
extracted from the PDF — that text may have wrapping or whitespace
artifacts that the parser has already normalized. Cite by stable IDs
from 'parsed' (e.g., 'acc-response-classroom-01', 'bench-3-03',
'goal-3').

The response also includes 'parse_quality' (per-section field counts)
and echo diagnostics ('anchors_found' / 'anchors_missing', head/tail
sample) so the teacher can verify nothing was lost in extraction.
`.trim();

export function registerUploadTools(server: McpServer): void {
  server.registerTool(
    "upload_iep",
    {
      title: "Upload an IEP",
      description: UPLOAD_IEP_DESCRIPTION,
      inputSchema: {
        content: z
          .string()
          .min(100, "IEP text seems too short — did extraction succeed?")
          .describe(
            "Full extracted text of the IEP document. For PDF attachments, pass the extracted text.",
          ),
      },
    },
    async ({ content }) => {
      const parsed = parseIep(content);
      const lines = content.split("\n").length;

      // Diagnostic envelope used in both success and parse-error paths.
      const echo = {
        received_chars: content.length,
        received_lines: lines,
        anchors_found: parsed.anchors_found,
        anchors_missing: parsed.anchors_missing,
        head: content.slice(0, 300),
        tail: content.slice(-300),
      };

      if (!parsed.meta.student_name) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "parse_error",
                  error:
                    "Could not extract a student name from the uploaded text. The document may not be a Massachusetts IEP, or extraction may have lost the Administrative Data Sheet.",
                  meta: parsed.meta,
                  ...echo,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const stored = saveIep(
        parsed.meta.student_name,
        parsed as unknown as Record<string, unknown>,
        content,
      );

      // Parse-quality summary — lets a reviewer spot incomplete extraction
      // without inspecting the saved file.
      const presentLevelsSummary = Object.fromEntries(
        Object.entries(parsed.present_levels).map(([k, v]) => [
          k,
          v
            ? {
                current_performance_chars: v.current_performance.length,
                strengths_chars: v.strengths.length,
                impact_chars: v.impact_of_disability.length,
              }
            : null,
        ]),
      );

      const accommodationsSummary = parsed.accommodations
        ? {
            contexts: Object.fromEntries(
              Object.entries(parsed.accommodations.contexts).map(([name, ctx]) => [
                name,
                {
                  presentation_of_instruction: ctx.presentation_of_instruction.length,
                  response: ctx.response.length,
                  timing_and_scheduling: ctx.timing_and_scheduling.length,
                  setting_and_environment: ctx.setting_and_environment.length,
                  total:
                    ctx.presentation_of_instruction.length +
                    ctx.response.length +
                    ctx.timing_and_scheduling.length +
                    ctx.setting_and_environment.length,
                },
              ]),
            ),
          }
        : null;

      const modificationsSummary = parsed.modifications
        ? {
            contexts: Object.fromEntries(
              Object.entries(parsed.modifications.contexts).map(([name, ctx]) => [
                name,
                {
                  content: ctx.content.length,
                  instruction: ctx.instruction.length,
                  student_output: ctx.student_output.length,
                  total:
                    ctx.content.length + ctx.instruction.length + ctx.student_output.length,
                },
              ]),
            ),
          }
        : null;

      const goalsSummary = parsed.goals.map((g) => ({
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
        full_lines: g.full_lines,
      }));

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
                // 'parsed' is the canonical structured view. Use this for
                // all downstream reasoning — do NOT fall back to the raw
                // IEP text passed in 'content'.
                parsed,
                parse_quality: {
                  concerns_captured: !!parsed.concerns,
                  present_levels: presentLevelsSummary,
                  accommodations: accommodationsSummary,
                  modifications: modificationsSummary,
                  goals: goalsSummary,
                },
                ...echo,
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
      description: `
Stores a lesson plan in Waypoint's registry. Call this whenever the user
attaches a lesson file to the conversation or pastes lesson content.
Required before generating modifications for the lesson.

INPUT
The 'content' parameter must be the full extracted text of the lesson.
Pass it verbatim — do not summarize, condense, or reformat. Preserve
original line breaks, paragraph markers like [N], and section headers
as they appear.

RESPONSE — IMPORTANT
The response contains a 'parsed' field with the canonical structured
view: meta (title, skill_standard, author), vocabulary, paragraphs
(with stable IDs like 'p1'), DRQs (with stable IDs like 'drq_p1_2_a',
modality, optional flag), MCQs (with stable IDs like 'mcq_1', standard
tag, options + options_text), short_response, discussion_questions
(with stable IDs like 'discussion_q1').

ALWAYS use 'parsed' as the source of truth for any subsequent
reasoning, citation, or modification work. Do NOT re-derive paragraph
text, DRQ prompts, MCQ options, or discussion questions from the raw
lesson text you extracted from the PDF — that text may have wrapping
or whitespace artifacts that the parser has already normalized. Cite
by stable IDs from 'parsed' (e.g., 'drq_p1_2_a', 'mcq_3',
'short_response_1', 'p4').

The response also includes echo diagnostics ('anchors_found' /
'anchors_missing', head/tail sample) so the teacher can verify
extraction.
      `.trim(),
      inputSchema: {
        content: z
          .string()
          .min(100, "Lesson text seems too short — did extraction succeed?")
          .describe(
            "Full extracted text of the lesson. For PDF attachments, pass the extracted text verbatim.",
          ),
      },
    },
    async ({ content }) => {
      const parsed = parseLesson(content);
      const lines = content.split("\n").length;

      const echo = {
        received_chars: content.length,
        received_lines: lines,
        anchors_found: parsed.anchors_found,
        anchors_missing: parsed.anchors_missing,
        head: content.slice(0, 300),
        tail: content.slice(-300),
      };

      if (!parsed.meta.title) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "parse_error",
                  error:
                    "Could not extract a lesson title from the uploaded text. Expected a 'TEACHER COPY: <title>' header.",
                  meta: parsed.meta,
                  ...echo,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const stored = saveLesson(
        parsed.meta.title,
        parsed as unknown as Record<string, unknown>,
        content,
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
                // 'parsed' is the canonical structured view. Use this for
                // all downstream reasoning — do NOT fall back to the raw
                // lesson text passed in 'content'.
                parsed,
                parse_quality: {
                  vocabulary: parsed.vocabulary.length,
                  paragraphs: parsed.paragraphs.length,
                  drqs: parsed.drqs.length,
                  mcqs_with_structured_options: parsed.mcqs.filter(
                    (m) => m.options.length === 4,
                  ).length,
                  mcqs_total: parsed.mcqs.length,
                  short_response: parsed.short_response ? 1 : 0,
                  discussion_questions: parsed.discussion_questions.length,
                },
                ...echo,
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
