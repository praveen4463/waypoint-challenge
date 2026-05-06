/**
 * Parses raw lesson text into a structured object. Designed for the
 * Riverstone Prep ELA "Community and Belonging" curriculum format.
 *
 * Server does deterministic structural extraction (title, paragraphs,
 * DRQs, MCQs, short response, discussion). Claude reasons about the
 * lesson at modification time. Extractors are intentionally forgiving —
 * pattern-based, .trim()-tolerant — so they keep working when the host
 * (Claude Desktop) reformats the document on its way to the tool.
 */

export interface ParsedLesson {
  meta: ParsedLessonMeta;
  vocabulary: VocabularyEntry[];
  paragraphs: ParsedParagraph[];
  drqs: ParsedDRQ[];
  mcqs: ParsedMCQ[];
  short_response?: ParsedShortResponse;
  discussion_questions: ParsedDiscussionQuestion[];
  raw_text: string;
  anchors_found: string[];
  anchors_missing: string[];
}

export interface ParsedLessonMeta {
  title?: string;
  author?: string;
  skill_standard?: string;
  purpose?: string;
}

export interface VocabularyEntry {
  word: string;
  pronunciation?: string;
}

export interface ParsedParagraph {
  id: string;
  number: number;
  text: string;
  start_line: number;
  end_line: number;
}

export interface ParsedDRQ {
  id: string;
  paragraph_range: string;
  letter: string;
  modality?: string;
  prompt: string;
  optional: boolean;
  start_line: number;
  end_line: number;
}

export interface ParsedMCQ {
  id: string;
  number: number;
  standard?: string;
  prompt: string;
  /** Best-effort structured options. May be empty if the source uses a
   *  layout we can't disentangle (e.g., "A. B. C. D." bunched markers
   *  followed by 4 text lines). Always cross-check with `options_text`. */
  options: { letter: string; text: string }[];
  /** Always-populated raw text of the options region — source of truth. */
  options_text: string;
  start_line: number;
  end_line: number;
}

export interface ParsedShortResponse {
  id: string;
  standard?: string;
  prompt: string;
  start_line: number;
  end_line: number;
}

export interface ParsedDiscussionQuestion {
  id: string;
  number: number;
  prompt: string;
  start_line: number;
  end_line: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// All anchors we report as found/missing in the upload echo. Keys map
// 1:1 to the parsed-lesson fields populated by the corresponding extractor.
const LESSON_ANCHOR_KEYS = [
  "title",
  "skill_standard",
  "vocabulary",
  "paragraphs",
  "drqs",
  "mcqs",
  "short_response",
  "discussion_questions",
] as const;

// Standalone meta patterns. Same shape as the IEP parser.
const LESSON_META_PATTERNS: ReadonlyArray<{ key: keyof ParsedLessonMeta; pattern: RegExp }> = [
  { key: "title", pattern: /TEACHER COPY:\s*(.+?)\s*$/im },
  { key: "skill_standard", pattern: /\[(RI\.\d+\.\d+|RL\.\d+\.\d+|W\.\d+\.\d+)\]/ },
];

// Trigger phrases used to locate sub-sections. Pattern-based, not header-keyed.
const PARAGRAPH_MARKER = /^\s*\[(\d+)\]\s*(.*)$/;
const DRQ_BLOCK_HEADER = /^\s*Paragraphs?\s+(\d+(?:\s*[-–]\s*\d+)?)/i;
const DRQ_QUESTION = /^\s*(\*?)\s*([A-Z])\.\s*(.*)$/;
const MCQ_NUMBERED = /^\s*(\d+)\.\s+(.*)$/;
const MCQ_OPTION = /^\s*([A-D])\.\s*(.+)$/;
const STANDARD_TAG = /\[(RI\.\d+|RL\.\d+|W\.\d+|L\.\d+)\]/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLineIndex(
  lines: string[],
  predicate: (line: string) => boolean,
  fromIndex = 0,
): number {
  for (let i = fromIndex; i < lines.length; i++) {
    if (predicate(lines[i])) return i;
  }
  return -1;
}

function findAllLineIndices(
  lines: string[],
  predicate: (line: string) => boolean,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (predicate(lines[i])) out.push(i);
  }
  return out;
}

function joinSlice(lines: string[], from: number, toExclusive: number): string {
  return lines
    .slice(from, toExclusive)
    .map((l) => l.replace(/\s+$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

function extractMeta(rawText: string, lines: string[]): ParsedLessonMeta {
  const meta: ParsedLessonMeta = {};
  for (const { key, pattern } of LESSON_META_PATTERNS) {
    const m = pattern.exec(rawText);
    if (m) (meta[key] as string) = m[1].trim();
  }
  // Author: line immediately after the "TEACHER COPY:" line, if it looks like a name.
  const titleIdx = findLineIndex(lines, (l) => /TEACHER COPY:/i.test(l));
  if (titleIdx !== -1 && titleIdx + 1 < lines.length) {
    const candidate = lines[titleIdx + 1].trim();
    if (/^[A-Z][\w'.\-]*(?:\s+[A-Z][\w'.\-]*)+$/.test(candidate)) {
      meta.author = candidate;
    }
  }
  return meta;
}

function extractVocabulary(lines: string[]): VocabularyEntry[] {
  // Vocab block follows "Let's pronounce these words together as a class:".
  // Each entry is "Word [pronunciation]" or just "Word". Stop at the first
  // line that doesn't look like a vocab entry — explicitly reject all-caps
  // lines (section headers like "WHOLE CLASS READING") and known anchors.
  const triggerIdx = findLineIndex(lines, (l) => /pronounce these words/i.test(l));
  if (triggerIdx === -1) return [];
  const isVocabStop = (line: string): boolean =>
    line === line.toUpperCase() && /[A-Z]/.test(line) ||
    /^(Paragraphs?\s+\d|Independent Practice|Student-Led Discussion)/i.test(line);
  const out: VocabularyEntry[] = [];
  for (let i = triggerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (isVocabStop(line)) break;
    const m = /^([A-Z][A-Za-z\- ]{1,40})(?:\s*\[([^\]]+)\])?$/.exec(line);
    if (!m) break;
    // Require at least one lowercase letter in the word — filters out
    // all-caps headers that match the lexical shape of a vocab entry.
    if (!/[a-z]/.test(m[1])) break;
    out.push({ word: m[1].trim(), pronunciation: m[2]?.trim() });
    if (out.length >= 12) break;
  }
  return out;
}

function extractParagraphs(lines: string[]): ParsedParagraph[] {
  // Find every [N] paragraph marker. Each paragraph runs until the next
  // paragraph marker, the start of a DRQ block, or the start of an
  // Independent Practice / Discussion section — whichever comes first.
  const starts: { line: number; number: number }[] = [];
  lines.forEach((line, i) => {
    const m = PARAGRAPH_MARKER.exec(line);
    if (m) starts.push({ line: i, number: parseInt(m[1], 10) });
  });
  if (starts.length === 0) return [];

  const isParagraphTerminator = (line: string): boolean =>
    DRQ_BLOCK_HEADER.test(line) ||
    /^\s*Independent Practice\s*$/i.test(line) ||
    /^\s*Student-Led Discussion\s*$/i.test(line);

  const paragraphs: ParsedParagraph[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const nextStart = starts[i + 1]?.line ?? lines.length;
    let end = nextStart;
    for (let j = start.line + 1; j < nextStart; j++) {
      if (isParagraphTerminator(lines[j])) {
        end = j;
        break;
      }
    }
    const firstLine = lines[start.line];
    const initialText = PARAGRAPH_MARKER.exec(firstLine)?.[2] ?? "";
    const restText = joinSlice(lines, start.line + 1, end);
    const text = [initialText, restText].filter((s) => s).join(" ").replace(/\s+/g, " ").trim();
    paragraphs.push({
      id: `p${start.number}`,
      number: start.number,
      text,
      start_line: start.line + 1,
      end_line: end,
    });
  }
  return paragraphs;
}

function extractDRQs(lines: string[]): ParsedDRQ[] {
  // Find every "Paragraphs X-Y" block header. Within each block, find
  // lettered questions ("A.", "*B.", "C.") and capture their prompt.
  // The block ends at the next paragraph marker, the next DRQ block, or
  // the start of Independent Practice — whichever comes first.
  const blockStarts: { line: number; range: string }[] = [];
  lines.forEach((line, i) => {
    const m = DRQ_BLOCK_HEADER.exec(line);
    if (m) blockStarts.push({ line: i, range: m[1].replace(/\s+/g, "") });
  });

  const isBlockTerminator = (line: string): boolean =>
    PARAGRAPH_MARKER.test(line) ||
    DRQ_BLOCK_HEADER.test(line) ||
    /^\s*Independent Practice\s*$/i.test(line) ||
    /^\s*Student-Led Discussion\s*$/i.test(line);

  const drqs: ParsedDRQ[] = [];
  for (let b = 0; b < blockStarts.length; b++) {
    const block = blockStarts[b];
    let blockEnd = lines.length;
    for (let j = block.line + 1; j < lines.length; j++) {
      if (isBlockTerminator(lines[j])) {
        blockEnd = j;
        break;
      }
    }

    // Find letter-prefixed questions inside the block.
    const qStarts: number[] = [];
    for (let j = block.line + 1; j < blockEnd; j++) {
      if (DRQ_QUESTION.test(lines[j])) qStarts.push(j);
    }

    for (let q = 0; q < qStarts.length; q++) {
      const qLine = qStarts[q];
      const qEnd = qStarts[q + 1] ?? blockEnd;
      const m = DRQ_QUESTION.exec(lines[qLine]);
      if (!m) continue;

      const optional = m[1] === "*";
      const letter = m[2];

      // The first sentence after the letter often carries the modality
      // ("Think & Share:", "Write:", "Turn & Talk:", "Find Evidence:").
      const head = m[3] ?? "";
      const modalityMatch = /^(Think & Share|Write|Turn & Talk|Find Evidence)\s*:\s*(.*)$/i.exec(head);
      const modality = modalityMatch?.[1];
      const restOfFirstLine = modalityMatch ? modalityMatch[2] : head;

      // Stop the prompt at the first answer-bullet line ("●") if present.
      let promptEnd = qEnd;
      for (let j = qLine + 1; j < qEnd; j++) {
        if (/^\s*[●•]/.test(lines[j])) {
          promptEnd = j;
          break;
        }
      }

      const remainder = joinSlice(lines, qLine + 1, promptEnd);
      const prompt = [restOfFirstLine, remainder].filter((s) => s).join(" ").replace(/\s+/g, " ").trim();

      drqs.push({
        id: `drq_p${block.range.replace(/[-–]/g, "_")}_${letter.toLowerCase()}`,
        paragraph_range: block.range,
        letter,
        modality,
        prompt,
        optional,
        start_line: qLine + 1,
        end_line: qEnd,
      });
    }
  }
  return drqs;
}

function extractMCQs(lines: string[]): ParsedMCQ[] {
  // MCQs follow an "Independent Practice" header that mentions "multiple choice".
  // Find that anchor, then collect numbered questions until the next major
  // section break.
  const anchorIdx = findLineIndex(
    lines,
    (l) =>
      /^\s*Independent Practice\s*$/i.test(l) &&
      // Confirm the next ~5 lines mention multiple choice
      false,
  );
  // Walk forward to find an Independent Practice block whose subsequent lines
  // mention "multiple choice".
  const ipIndices = findAllLineIndices(lines, (l) =>
    /^\s*Independent Practice\s*$/i.test(l),
  );
  let mcqStartIdx = -1;
  for (const ix of ipIndices) {
    const window = lines.slice(ix, Math.min(ix + 6, lines.length)).join(" ");
    if (/multiple choice/i.test(window)) {
      mcqStartIdx = ix;
      break;
    }
  }
  // Ignore unused declaration warning; anchorIdx kept for parallel structure.
  void anchorIdx;
  if (mcqStartIdx === -1) return [];

  // End at the next "Independent Practice", "Student-Led Discussion", or
  // "PROMPT:" line.
  let mcqEnd = lines.length;
  for (let j = mcqStartIdx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (
      (j !== mcqStartIdx && /^\s*Independent Practice\s*$/i.test(l)) ||
      /^\s*Student-Led Discussion\s*$/i.test(l) ||
      /^\s*PROMPT:/.test(l)
    ) {
      mcqEnd = j;
      break;
    }
  }

  const numbered = findAllLineIndices(lines, (l) => MCQ_NUMBERED.test(l)).filter(
    (i) => i > mcqStartIdx && i < mcqEnd,
  );

  const mcqs: ParsedMCQ[] = [];
  for (let q = 0; q < numbered.length; q++) {
    const start = numbered[q];
    const end = numbered[q + 1] ?? mcqEnd;
    const m = MCQ_NUMBERED.exec(lines[start]);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    const promptHead = m[2] ?? "";

    // Find the first option line within this Q's range.
    let optionStart = end;
    for (let j = start + 1; j < end; j++) {
      if (MCQ_OPTION.test(lines[j])) {
        optionStart = j;
        break;
      }
    }
    const promptRemainder = joinSlice(lines, start + 1, optionStart);
    const fullPrompt = [promptHead, promptRemainder].filter((s) => s).join(" ").replace(/\s+/g, " ").trim();
    const standard = STANDARD_TAG.exec(fullPrompt)?.[1];
    const cleanedPrompt = fullPrompt.replace(STANDARD_TAG, "").replace(/\s+/g, " ").trim();

    // Always capture the raw options region (source of truth).
    const options_text = joinSlice(lines, optionStart, end);

    // Best-effort structured extraction. We slice between consecutive
    // letter markers found anywhere in the region's joined text. Verifies
    // each captured chunk is non-trivial (>=2 chars) before keeping it.
    const region = lines.slice(optionStart, end).join("\n");
    const markerRe = /\b([A-D])\.\s/g;
    const markers: { letter: string; pos: number }[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = markerRe.exec(region)) !== null) {
      markers.push({ letter: mm[1], pos: mm.index + mm[0].length });
    }
    const options: { letter: string; text: string }[] = [];
    for (let mi = 0; mi < markers.length; mi++) {
      const stopAt = markers[mi + 1] ? markers[mi + 1].pos - 3 : region.length;
      const slice = region.slice(markers[mi].pos, stopAt).replace(/\s+/g, " ").trim();
      if (slice.length >= 2) {
        options.push({ letter: markers[mi].letter, text: slice });
      }
    }
    // If we ended up with fewer than 4 distinct lettered options, prefer
    // the raw text and keep options as an empty array — clearer signal.
    const distinctLetters = new Set(options.map((o) => o.letter));
    const finalOptions = distinctLetters.size === 4 ? options : [];

    mcqs.push({
      id: `mcq_${number}`,
      number,
      standard,
      prompt: cleanedPrompt,
      options: finalOptions,
      options_text,
      start_line: start + 1,
      end_line: end,
    });
  }

  return mcqs;
}

function extractShortResponse(lines: string[]): ParsedShortResponse | undefined {
  const promptIdx = findLineIndex(lines, (l) => /^\s*PROMPT:/.test(l));
  if (promptIdx === -1) return undefined;

  // End at "SELF CHECKLIST" or the start of the next section.
  let end = lines.length;
  for (let j = promptIdx + 1; j < lines.length; j++) {
    if (
      /^\s*SELF CHECKLIST/i.test(lines[j]) ||
      /^\s*Student-Led Discussion/i.test(lines[j]) ||
      /^\s*Independent Practice/i.test(lines[j])
    ) {
      end = j;
      break;
    }
  }

  const head = lines[promptIdx].replace(/^\s*PROMPT:\s*/, "");
  const rest = joinSlice(lines, promptIdx + 1, end);
  const fullPrompt = [head, rest].filter((s) => s).join(" ").replace(/\s+/g, " ").trim();
  const standard = STANDARD_TAG.exec(fullPrompt)?.[1];
  const cleanedPrompt = fullPrompt.replace(STANDARD_TAG, "").replace(/\s+/g, " ").trim();

  return {
    id: "short_response_1",
    standard,
    prompt: cleanedPrompt,
    start_line: promptIdx + 1,
    end_line: end,
  };
}

function extractDiscussion(lines: string[]): ParsedDiscussionQuestion[] {
  const anchorIdx = findLineIndex(lines, (l) => /^\s*Student-Led Discussion\s*$/i.test(l));
  if (anchorIdx === -1) return [];

  // End at end of file or the next major header.
  let end = lines.length;
  for (let j = anchorIdx + 1; j < lines.length; j++) {
    if (/^\s*(Independent Practice|TEACHER COPY:)/i.test(lines[j])) {
      end = j;
      break;
    }
  }

  const numbered = findAllLineIndices(lines, (l) => MCQ_NUMBERED.test(l)).filter(
    (i) => i > anchorIdx && i < end,
  );

  const out: ParsedDiscussionQuestion[] = [];
  for (let q = 0; q < numbered.length; q++) {
    const start = numbered[q];
    const finish = numbered[q + 1] ?? end;
    const m = MCQ_NUMBERED.exec(lines[start]);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    const head = m[2] ?? "";

    // Stop at the first "My answer / My partner's answer" line.
    let promptEnd = finish;
    for (let j = start + 1; j < finish; j++) {
      if (/^\s*My answer/i.test(lines[j])) {
        promptEnd = j;
        break;
      }
    }
    const rest = joinSlice(lines, start + 1, promptEnd);
    const prompt = [head, rest].filter((s) => s).join(" ").replace(/\s+/g, " ").trim();

    out.push({
      id: `discussion_q${number}`,
      number,
      prompt,
      start_line: start + 1,
      end_line: promptEnd,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseLesson(rawText: string): ParsedLesson {
  const lines = rawText.split("\n");

  const meta = extractMeta(rawText, lines);
  const vocabulary = extractVocabulary(lines);
  const paragraphs = extractParagraphs(lines);
  const drqs = extractDRQs(lines);
  const mcqs = extractMCQs(lines);
  const short_response = extractShortResponse(lines);
  const discussion_questions = extractDiscussion(lines);

  // Diagnostics: which extractors found content.
  const present: Record<(typeof LESSON_ANCHOR_KEYS)[number], boolean> = {
    title: !!meta.title,
    skill_standard: !!meta.skill_standard,
    vocabulary: vocabulary.length > 0,
    paragraphs: paragraphs.length > 0,
    drqs: drqs.length > 0,
    mcqs: mcqs.length > 0,
    short_response: !!short_response,
    discussion_questions: discussion_questions.length > 0,
  };
  const anchors_found = LESSON_ANCHOR_KEYS.filter((k) => present[k]);
  const anchors_missing = LESSON_ANCHOR_KEYS.filter((k) => !present[k]);

  return {
    meta,
    vocabulary,
    paragraphs,
    drqs,
    mcqs,
    short_response,
    discussion_questions,
    raw_text: rawText,
    anchors_found,
    anchors_missing,
  };
}
