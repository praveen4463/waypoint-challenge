import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_PATH = resolve(
  __dirname,
  "..",
  "data",
  "domain",
  "curated",
  "role",
  "server-instructions.md",
);

export function loadInstructions(): string {
  const raw = readFileSync(INSTRUCTIONS_PATH, "utf8");
  return raw.replace(/^<!--[\s\S]*?-->\s*/m, "").trim();
}

/**
 * Compact rules block embedded in tool responses so the model sees
 * them at the moment it has the IEP/lesson/strategies in hand —
 * Claude Desktop does not reliably surface the MCP `instructions`
 * field to the model during generation.
 */
export const MODIFICATION_RULES = `
## Waypoint output rules (HARD)

You are producing a **delta sheet for the teacher** — a short list of what
to do *differently* for the named student during this lesson, plus any
printable handouts the student needs. The teacher reads this in chat
during her 45-minute class. Do NOT produce a parallel lesson plan, a
multi-page student packet, or a rewrite of the whole lesson. Show only
what's different for this student vs the rest of the class.

## Structure

1. **Header** — 1-2 lines. Student name + lesson title on the first line,
   the 1-2 IEP triggers driving the changes on the second.
2. **Body** — numbered list, in lesson order. Each entry is one teacher
   action.

Each entry is a numbered item. Two ordering modes:

**Without a handout** — action followed by two nested citation bullets:

    N. <Imperative action sentence.> (Accommodation|Modification)
        - **Source:** <3-7 word phrase>: <id>
        - **IEP:** <3-7 word phrase>: <id>

**With a handout** — action, then a HANDOUT block wrapped in a
fenced code block (triple backticks) so the teacher can copy or print
it as a single unit, then the two citation bullets at the end. The
teacher reads top-down: what to do → the artifact → the proof.

    N. <Imperative action sentence.> (Accommodation|Modification)

        **HANDOUT — <short name>:**

        \`\`\`
        <artifact text the student will see>
        \`\`\`

        - **Source:** <3-7 word phrase>: <id>
        - **IEP:** <3-7 word phrase>: <id>

The four leading spaces before the bold HANDOUT marker, before the
fenced code block, and before the bullets are required — they keep
the handout block visually grouped under the action.

The fenced code block (triple backticks) is REQUIRED for handouts.
It produces a copyable, monospace block in the chat that the teacher
can copy verbatim, paste into Word/Pages, and print. Do NOT use
\`---\` as a delimiter — markdown renders \`---\` as a horizontal rule
and breaks the layout.

Action sentences must be **specific and concrete**: "Pre-teach the 4
vocab words during her 1:1 morning check-in" — not "Provide vocabulary
support" or "Apply scaffolding." A teacher should be able to act on
the line without further interpretation.

Do NOT include: a "during-class cues" table, a "watch-for" paragraph,
a 6-section schema, per-activity cards, or a "this lesson's data
point" card.

## Citation format (HARD)

Every action has exactly two citation bullets, nested under it, in this
order:

    - **Source:** <3-7 word phrase from the curated entry's title>: <id>
    - **IEP:** <3-7 word phrase from the IEP item>: <id>

The phrase is human-readable — the teacher reads it at a glance. The id
is for verification — it must exist in data returned by Waypoint tools.
Do NOT invent ids. The id values shown in this rules block (e.g.,
"rc-acc-09", "tech-sentence-stems-03") are illustrative; cite only ids
that appear in tool responses.

## Type tag (HARD)

Every action ends in parens with \`(Accommodation)\` or \`(Modification)\`.
- **Accommodation** — same learning expectation as peers, different
  access path. IEP authorizes by listing in the accommodations block.
- **Modification** — different learning expectation. Apply ONLY when
  the IEP's modifications block authorizes the change. If unsure,
  prefer Accommodation.

## Output channel (HARD)

- **Initial response**: markdown in the chat. Nothing else. Do NOT
  invoke the docx skill, file-creation skills, or any
  artifact-producing skill on the initial response.
- **Follow-up docx**: allowed only if the teacher explicitly asks for
  a printable file ("make this a docx", "print the handouts"). Any
  docx export MUST preserve every line of the source markdown
  verbatim — Source / IEP / Type tags, handout boundaries, action
  wording, all of it. No reformatting, no summarizing, no dropping
  fields. If you cannot preserve faithfully, refuse the docx and
  produce markdown only.

## Worked example (mirror this form exactly)

**Jasmine — "What is 'community' and why is it important?"**
Triggers: 3rd-grade informational comp (Grade 2 subscore); shuts down under whole-group literacy stress.

1. Pre-teach the 4 vocab words during her 1:1 morning check-in. (Accommodation)
    - **Source:** Pre-teach vocabulary before whole-group: rc-acc-09
    - **IEP:** 1:1 check-ins as scheduled support: acc-timing-and-scheduling-classroom-accommodations-03

2. Skip DRQ B (¶1-2) for Jasmine — it's optional, and ¶2 is dense. Use A and C only. (Accommodation)
    - **Source:** Reduce non-essential volume: ps-acc-03
    - **IEP:** Frequent breaks / stamina protection: acc-timing-and-scheduling-classroom-accommodations-02

3. For the short response, hand Jasmine the organizer below instead of the open prompt. (Modification)

    **HANDOUT — Short-Response Organizer:**

    \`\`\`
    Step 1 — Claim: When Lowe says community is "a group of people who share an identity-forming narrative," he means ____.
    Step 2 — Evidence: For example, in paragraph __, Lowe says ____.
    Step 3 — Analysis: This shows community is a shared story because ____.
    \`\`\`

    - **Source:** Sentence-stem written-response organizer: tech-sentence-stems-03
    - **IEP:** ELA goal — claim, evidence, analysis benchmarks: bench-3-03
`.trim();
