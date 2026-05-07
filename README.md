# Waypoint MCP Server

My submission for the Waypoint Learning founding-engineer challenge. An MCP server that gives Claude the structured context it needs to translate a student's IEP into lesson-specific instructional modifications a teacher can use the next morning.

## What it does

Given a registered student's IEP and a registered lesson, the server lets Claude (running in Claude Desktop) produce per-activity modifications: original prompt, modified version for this student, why it addresses this student's specific needs, the type (accommodation vs modification), and a citation back to specific IEP items and curated strategies. The teacher reads the output as markdown cards inline in the chat — no file downloads, no copy-out-of-PDF.

The server itself does **not** call an LLM. It is a context provider and tool layer. Claude is the only model in the loop.

## Stack

- TypeScript, Node 18+, npm
- `@modelcontextprotocol/sdk` for the MCP server
- `zod` for tool-input validation (Anthropic enforces the schema server-side at tool-call time)
- File-system persistence — no database

## How to run

```bash
npm install
npm run build
```

Add to your Claude Desktop MCP config at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "waypoint": {
      "command": "node",
      "args": ["/absolute/path/to/waypoint-challenge/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. The server registers eight tools — `upload_iep`, `upload_lesson`, `find_student`, `find_lesson`, `list_students`, `list_lessons`, `list_strategies_catalog`, `get_strategies` — and an MCP `instructions` block that tells Claude how to format the modification output.

### Demo flow

1. In Claude Desktop, drag in an IEP PDF and ask Claude to register the student. Claude calls `upload_iep` with structured fields it extracted from the PDF; the server validates, stamps stable IDs, and persists.
2. Drag in a lesson PDF. Same flow via `upload_lesson`.
3. Ask: _"Modify this lesson for Jasmine."_ Claude resolves the student/lesson via `find_student` and `find_lesson`, pulls relevant strategies via `get_strategies` (tag-based, see below), and renders the modified lesson as cards in the chat.

The sample IEP and lesson Waypoint provided are not bundled here — please don't redistribute.

## Architecture decisions

### One LLM only

The server is a context layer; Claude (in Claude Desktop) does all the reasoning. I considered adding a server-side LLM call to pre-generate parts of the modification, but it doubled the failure surface (now two models can disagree about the same content) and bought nothing — Claude is the surface the teacher actually reads, so the second LLM's output would be re-rendered downstream anyway. With one LLM, there's no API key to manage, no model-selection logic, no streaming, and no orchestration code. The whole server becomes "give Claude clean structures and let it work."

### LLM-driven structured extraction over server-side PDF parsing

I started with server-side parsing (regex, column-position-aware tables, `pdftotext -layout`). Burned hours on it. The Massachusetts Riverstone Prep IEP form has multi-line cells, and every column-position approach I tried broke the moment a cell wrapped onto a second line. I shipped a vendored `pdftotext` binary, then a column-aware extractor; both failed on real input.

I pivoted: Claude reads the PDF directly and submits structured fields via the `upload_iep` / `upload_lesson` tools, validated against a zod schema that mirrors the form. The server validates shape, stamps stable IDs, persists.

Trade:

- (+) Deleted ~1500 lines of brittle parser code. No PDF library, no system binary dependency.
- (+) Anthropic enforces the zod schema server-side at the tool-call boundary, so shape failures fail before our code runs.
- (−) Content fidelity now depends on Claude's reading. In testing on Jasmine's IEP and the community lesson, extraction was excellent overall — every section captured verbatim, IDs stamped cleanly. One accommodation got placed in the wrong column (Reference sheets ended up under `presentation_of_instruction` when it belonged in `response`). Tightenable with `.describe()` hints in a v2.

### Structured navigable data, not chunks

I don't chunk the IEP or lesson for retrieval. Both are stored as structured JSON with the form's actual field names (`present_levels.academics.current_performance`, `goals[].annual_target.target`, `accommodations["Classroom Accommodations"].timing_and_scheduling[]`, etc.) and stable IDs on every leaf item.

Reasons:

- Embedding-based chunking adds machinery (vector DB, embedding model, similarity ranking) for a payload Claude can already parse natively. Once Claude has the JSON, it can navigate to "goal 3, benchmark 3" or "the timing accommodations under Classroom" without help.
- Citations need to be stable. `bench-3-03` survives an IEP revision in a way that "the chunk that contained the third benchmark of goal 3" doesn't.
- Field names mirror the IEP form, so the JSON is self-documenting — anyone reading `iep.json` can see the same structure they'd see in the original PDF.

### Curated knowledge, tag-based retrieval, no embeddings

The accommodation / modification / measuring-goals knowledge base is hand-curated JSON across these axes:

- `by-cognitive-deficit/` — maps to IEP present-levels (short-term-memory, processing-speed, etc.)
- `by-context/` — maps to lesson-activity context (instructional-delivery, transitions, testing-assessment, etc.)
- `by-profile/` — disability cluster (anxiety, executive-function, dyslexia, etc.)
- `by-achievement-deficit/` — maps to IEP goal areas (reading-comprehension, written-expression, basic-math)
- `modifications/` — curriculum / assignment / assessment modifications
- `measuring-goals/` — data-collection cadence, picking-one-objective, progress-reporting templates

Retrieval is `get_strategies(tags: string[])` — tag overlap, not vector similarity.

Reasons:

- The dataset is small (~30–50 entries across ~15 categories). At that scale tag retrieval is faster, simpler, and more debuggable than embeddings.
- The tags use the language IEPs already use (deficit names, profile names, context names). Claude picks tags from the IEP's present-levels with no translation.
- Every entry has a stable `id` — citations point to a specific entry, not an "approximate semantic match."

### Stable IDs and hard citation rule

Every leaf across IEP and lesson gets a server-stamped ID:

| Item           | ID convention                      | Example                                                 |
| -------------- | ---------------------------------- | ------------------------------------------------------- |
| Goal           | `goal-{N}`                         | `goal-3`                                                |
| Benchmark      | `bench-{goalN}-{NN}`               | `bench-3-03`                                            |
| Accommodation  | `acc-{column}-{context-slug}-{NN}` | `acc-timing-and-scheduling-classroom-accommodations-01` |
| Modification   | `mod-{column}-{context-slug}-{NN}` | `mod-instruction-classroom-modifications-01`            |
| Paragraph      | `p{N}`                             | `p4`                                                    |
| DRQ            | `drq_p{range}_{letter}`            | `drq_p1_2_a`                                            |
| MCQ / option   | `mcq_{N}` / `mcq_{N}_{letter}`     | `mcq_3` / `mcq_3_B`                                     |
| Short response | `short_response_1`                 |                                                         |
| Discussion     | `discussion_q{N}`                  | `discussion_q2`                                         |
| Vocab          | `vocab-{NN}`                       | `vocab-04`                                              |

Server-instructions.md enforces:

- Every per-activity card MUST end with a `Cite:` line listing every source used, separated by `·`. IDs only — no prose handwave.
- Every card MUST tag `Type: Accommodation` or `Type: Modification`. Modifications must cite the IEP's modifications-block authorization (legal requirement: a modification without IEP authorization is non-compliant).
- Cards without `Cite:` are invalid output.

`scripts/verify-modification.mjs` walks the markdown output, parses every `Cite:` line, and checks each ID against the registered IEP, lesson, and curated strategies. The reviewer can use it to confirm no IDs were hallucinated.

### Rules embedded in tool responses, not just MCP `instructions`

I learned mid-build that Claude Desktop does not reliably surface the MCP `instructions` field to the model during generation. I diagnosed by asking Claude in the same session _"what are the citation rules?"_ and getting _"I don't have specific information about that."_ The instructions field is sent at connection time but evidently doesn't survive into the per-turn system prompt.

Fix: every relevant tool response (`upload_iep`, `upload_lesson`, `find_student`, `find_lesson`, `get_strategies`) returns a `rules` field containing the structure + hard `Cite:` + hard `Type:` + markdown-only rules. So Claude sees the rules in the same response that hands it the IEP/lesson/strategies — exactly when it's about to generate.

### File system, not a database

```
file-system-db/
  indexed/
    students/<slug>/iep.json
    lessons/<slug>/lesson.json
```

Slugs come from student name / lesson title. Re-uploads overwrite. No DB because the read pattern is "find by hint" (fuzzy match against slugs), and the data is already in the right shape on disk. A real production system would add per-class indexing and a way to share IEPs across teachers, but for a single-teacher MVP this is enough.

## Output format

Markdown in the chat. No docx, no PDF, no file artifacts on the initial response — and the rule explicitly forbids invoking Claude Desktop's docx skill on first generation, because every docx template I tested stripped the `Cite:` lines.

Six sections, in order:

1. One-paragraph summary — what changed and why.
2. Pre-class prep checklist (3–5 bullets).
3. **Per-activity cards** — one per DRQ, MCQ, short response, discussion question. Original prompt with stable ID, modified version, why, `Type:`, `Cite:`.
4. During-class cues table (Time | What's happening | What you do).
5. Watch-for — 1–2 bullets on the IEP's specific avoidance pattern, with citation.
6. This lesson's data point — exactly ONE benchmark to score this lesson, the artifact to score, the rubric, the logging instruction.

A docx may be produced on a follow-up request from the teacher, and only if the citation lines survive intact.

## Verifying output

```bash
node scripts/verify-modification.mjs <path/to/claude-output.md>
```

Parses every `Cite:` line, resolves each ID against the registered IEP, lesson, and curated strategies. Fails loudly on any unresolved ID.

## Example

The output for Jasmine Bailey's IEP × "What is 'community' and why is it important?" lesson is in `examples/jasmine-community.md`. To regenerate, register both files in Claude Desktop and ask Claude to modify the lesson for Jasmine.

## What's not here

- No web UI. The teacher's surface is Claude Desktop.
- No multi-student rollups, no district export, no dashboards.
- No cross-conversation memory beyond the file-system registry — conversation context lives in Claude Desktop.
- Content extraction can occasionally misassign accommodation text across the four columns of the IEP form. Mitigatable with field-level `.describe()` hints; flagged for v2.

## What I'd do next

- Tighten extraction with `.describe()` on every zod field, plus a self-check tool that asks Claude to verify column boundaries on the parsed IEP before storing.
- Goal-progress logging (Phase 2 in `.claude/decisions.md`) — close the loop by letting the teacher log per-benchmark scores after class and auto-draft the quarterly progress report from `measuring-goals/data-collection-and-progress-reporting.json`. The IEP work-bins transcript I curated names data collection as the teacher's #1 pain point.
- A regression suite: 3 fixed IEP × lesson combinations with expected citation density and `Type:` distribution. Catches drift in either the curated library or server-instructions.md.
- Per-class indexing so a teacher with 20 IEPs doesn't need to re-register every student per conversation.

## Repo layout

```
src/
  index.ts              # entry point
  server.ts             # MCP server creation
  instructions.ts       # loads server-instructions.md, exports MODIFICATION_RULES
  types/
    iep.ts              # zod input schema + stored type
    lesson.ts           # same for lessons
  tools/
    upload.ts           # upload_iep, upload_lesson
    retrieve.ts         # find_student, find_lesson, list_*
    strategies.ts       # list_strategies_catalog, get_strategies
  domain/
    catalog.ts          # curated library catalog loader
    strategies.ts       # tag-based retrieval
    tags.ts             # canonical tag vocabulary
  storage/
    iep.ts, lessons.ts, slugify.ts   # file-system persistence
  utils/
    ids.ts              # server-side ID stamping with dedup
data/
  domain/               # domain knowledge data that helps find strategies and tools per the IEP
    raw/                # source materials used to generate the curated data
    curated/
      role/server-instructions.md   # MCP instructions content
      accommodations/, modifications/, measuring-goals/
file-system-db/
  indexed/students/<slug>/iep.json
  indexed/lessons/<slug>/lesson.json
scripts/
  verify-modification.mjs
.claude/
  decisions.md, implementation-plan.md   # design rationale
```
