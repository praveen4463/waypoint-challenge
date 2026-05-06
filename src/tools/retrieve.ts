import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findIepByStudent, listIeps } from "../storage/iep.js";
import { findLessonByHint, listLessons } from "../storage/lessons.js";

const FIND_STUDENT_DESCRIPTION = `
Resolve a free-text hint (typically the Claude Project name, e.g.
"Jasmine Bailey", or just a first name like "jasmine") to a stored
student IEP. Returns the parsed IEP — meta, profile, present-levels,
sections, and goals — for the matched student.

Use this whenever the teacher asks about a student. The 'hint' need not
be the exact slug; partial / first-name / last-name matches are
resolved by the server.

If no match is found, the response is { status: "missing_data" } with a
'remediation' message — relay that to the teacher and help them upload
the missing IEP via upload_iep.
`.trim();

const FIND_LESSON_DESCRIPTION = `
Resolve a free-text hint (e.g. "lesson 1", "community", "what is
community") to a stored lesson. Returns the parsed lesson — meta,
vocabulary, paragraphs, DRQs, MCQs, short response, discussion
questions — for the matched lesson.

Use this whenever the teacher asks about a specific lesson. Partial-
title / keyword matches are resolved by the server.

If no match is found, the response is { status: "missing_data" } with a
'remediation' message — relay that to the teacher and help them upload
the missing lesson via upload_lesson.
`.trim();

export function registerRetrieveTools(server: McpServer): void {
  server.registerTool(
    "find_student",
    {
      title: "Find an uploaded student IEP",
      description: FIND_STUDENT_DESCRIPTION,
      inputSchema: {
        hint: z
          .string()
          .min(1)
          .describe("Free-text hint — project name, first name, or any partial."),
      },
    },
    async ({ hint }) => {
      const record = findIepByStudent(hint);
      if (!record) {
        const all = listIeps();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "missing_data",
                  type: "iep",
                  hint,
                  remediation:
                    "No IEP found matching that hint. Ask the teacher to attach the student's IEP file and call upload_iep with the extracted text content.",
                  available_students: all.map((s) => ({
                    slug: s.slug,
                    student_name: s.student_name,
                  })),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(record, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "find_lesson",
    {
      title: "Find an uploaded lesson",
      description: FIND_LESSON_DESCRIPTION,
      inputSchema: {
        hint: z
          .string()
          .min(1)
          .describe("Free-text hint — title fragment, keyword, or 'lesson N'."),
      },
    },
    async ({ hint }) => {
      const record = findLessonByHint(hint);
      if (!record) {
        const all = listLessons();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "missing_data",
                  type: "lesson",
                  hint,
                  remediation:
                    "No lesson found matching that hint. Ask the teacher to attach the lesson file and call upload_lesson with the extracted text content.",
                  available_lessons: all.map((l) => ({
                    slug: l.slug,
                    title: l.title,
                  })),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(record, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "list_students",
    {
      title: "List all uploaded student IEPs",
      description:
        "Returns the slug, student_name, and uploaded_at for every IEP currently registered with Waypoint. Use to discover which students have been uploaded.",
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ students: listIeps() }, null, 2) },
      ],
    }),
  );

  server.registerTool(
    "list_lessons",
    {
      title: "List all uploaded lessons",
      description:
        "Returns the slug, title, and uploaded_at for every lesson currently registered with Waypoint. Use to discover which lessons have been uploaded.",
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ lessons: listLessons() }, null, 2) },
      ],
    }),
  );
}
