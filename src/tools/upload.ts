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

The 'content' parameter must be the full extracted text of the IEP
document (Massachusetts Riverstone Prep template). When the user attaches
a PDF, extract the text and pass it through.

The response includes parse diagnostics ('anchors_found' /
'anchors_missing', 'received_chars', a head/tail sample of the received
content) so the teacher can verify nothing was lost in extraction.
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "ok",
                student_slug: stored.slug,
                student_name: stored.student_name,
                meta: parsed.meta,
                profile: parsed.profile,
                counts: {
                  goals: parsed.goals.length,
                  sections_present: Object.values(parsed.sections).filter(Boolean).length,
                  present_levels_present: Object.values(parsed.present_levels).filter(Boolean).length,
                },
                goals: parsed.goals.map((g) => ({
                  id: g.id,
                  area: g.area,
                  full_lines: g.full_lines,
                })),
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

The 'content' parameter must be the full extracted text of the lesson
(Riverstone Prep ELA "Community and Belonging" curriculum format). When
the user attaches a PDF, extract the text and pass it through.

Pass the document content verbatim — do not summarize, condense, or
reformat. Preserve original line breaks, paragraph markers like [N], and
section headers as they appear.

The response includes parse diagnostics (anchors_found / anchors_missing,
received_chars, a head/tail sample) so the teacher can verify extraction.
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
                meta: parsed.meta,
                counts: {
                  vocabulary: parsed.vocabulary.length,
                  paragraphs: parsed.paragraphs.length,
                  drqs: parsed.drqs.length,
                  mcqs: parsed.mcqs.length,
                  short_response: parsed.short_response ? 1 : 0,
                  discussion_questions: parsed.discussion_questions.length,
                },
                paragraphs: parsed.paragraphs.map((p) => ({
                  id: p.id,
                  number: p.number,
                  start_line: p.start_line,
                  end_line: p.end_line,
                  preview: p.text.slice(0, 80),
                })),
                drqs: parsed.drqs.map((d) => ({
                  id: d.id,
                  paragraph_range: d.paragraph_range,
                  modality: d.modality,
                  optional: d.optional,
                  preview: d.prompt.slice(0, 80),
                })),
                mcqs: parsed.mcqs.map((m) => ({
                  id: m.id,
                  standard: m.standard,
                  options_structured_count: m.options.length,
                  preview: m.prompt.slice(0, 80),
                })),
                short_response: parsed.short_response
                  ? {
                      id: parsed.short_response.id,
                      standard: parsed.short_response.standard,
                      preview: parsed.short_response.prompt.slice(0, 100),
                    }
                  : null,
                discussion_questions: parsed.discussion_questions.map((q) => ({
                  id: q.id,
                  preview: q.prompt.slice(0, 80),
                })),
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
