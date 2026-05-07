import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRootCatalog } from "../domain/catalog.js";
import { getStrategies } from "../domain/strategies.js";
import { partitionTags, TAG_VOCABULARY } from "../domain/tags.js";
import { MODIFICATION_RULES } from "../instructions.js";

const LIST_CATALOG_DESCRIPTION = `
Returns the root catalog of Waypoint's curated domain library: all
sections (accommodations by context / by profile / by cognitive deficit
/ by achievement deficit, modifications, measuring-goals) plus the
canonical tag vocabulary.

Read this first when you don't know which tags to use. Then call
get_strategies with the tags you've selected based on the student's IEP
present-levels and the lesson activity.
`.trim();

const GET_STRATEGIES_DESCRIPTION = `
Returns curated accommodation strategies, modifications, and (where
relevant) measuring-goals references whose applies_to tags overlap with
any tag you request. Use to ground modifications in the student's IEP
profile and the lesson activity.

Tag vocabulary (canonical strings — must use exactly these):
- cognitive_deficits: long-term-retrieval, short-term-memory,
  processing-speed, auditory-processing, phonemic-awareness,
  visual-spatial, comprehension-knowledge, fluid-reasoning
- achievement_deficits: basic-reading, reading-comprehension, spelling,
  basic-math, math-reasoning, penmanship, written-expression
- contexts: environment, transitions, tools-equipment,
  language-communication, peer-social, sensory, behavior,
  testing-assessment, instructional-delivery
- profiles: anxiety, executive-function, nvld, adhd-attention,
  dyslexia, autism

Pass 'tags' as a flat array drawn from any of the four categories. Each
returned file includes its source citation — use 'source.name' plus
individual item IDs (e.g., 'rc-acc-03', 'tech-sq4r') when citing
strategies in modification output.
`.trim();

export function registerStrategyTools(server: McpServer): void {
  server.registerTool(
    "list_strategies_catalog",
    {
      title: "List the strategies catalog",
      description: LIST_CATALOG_DESCRIPTION,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify(getRootCatalog(), null, 2) },
      ],
    }),
  );

  server.registerTool(
    "get_strategies",
    {
      title: "Get strategies by tags",
      description: GET_STRATEGIES_DESCRIPTION,
      inputSchema: {
        tags: z
          .array(z.string())
          .min(1)
          .describe(
            "Flat array of canonical tags (any of cognitive_deficits / achievement_deficits / contexts / profiles).",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(24)
          .default(6)
          .describe(
            "Top-N most relevant files to return. Defaults to 6. Increase if you need broader coverage.",
          ),
      },
    },
    async ({ tags, limit }) => {
      const { valid, unknown } = partitionTags(tags);
      const allMatches = getStrategies(valid);
      const returned = allMatches.slice(0, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tags_requested: tags,
                tags_unknown: unknown,
                tag_vocabulary: TAG_VOCABULARY,
                total_matches: allMatches.length,
                returned: returned.length,
                files: returned,
                truncated: allMatches.length > returned.length,
                truncated_files: allMatches.length > returned.length
                  ? allMatches.slice(returned.length).map((m) => ({
                      relative_path: m.relative_path,
                      title: m.data.title,
                      matched_tags: m.matched_tags,
                    }))
                  : [],
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
