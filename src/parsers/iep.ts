/**
 * Parses raw IEP text deterministically into a structured object.
 *
 * Layout:
 *   meta + concerns + present_levels + profile + accommodations +
 *   modifications + goals.
 *
 * Each section carries a 'description' field that explains what the
 * section is for (paraphrased from the form template). This is what
 * Claude reads to understand the section's purpose.
 *
 * Server does deterministic structural extraction. Claude does the
 * semantic mapping (deficit → tag → strategy) at retrieval time.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedIep {
  meta: ParsedMeta;
  concerns?: ConcernsBlock;
  present_levels: PresentLevelsBlock;
  profile: ParsedProfile;
  accommodations?: AccommodationsBlock;
  modifications?: ModificationsBlock;
  goals: ParsedGoal[];
  /** Diagnostics for upload-time echo. */
  anchors_found: string[];
  anchors_missing: string[];
}

export interface ParsedMeta {
  student_name?: string;
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
}

export interface ConcernsBlock {
  description: string;
  text: string;
  start_line?: number;
  end_line?: number;
}

export type PresentLevelKey =
  | "academics"
  | "behavioral"
  | "communication"
  | "additional_areas";

export type PresentLevelsBlock = Partial<Record<PresentLevelKey, PresentLevelEntry>>;

export interface PresentLevelEntry {
  header_text: string;
  description: string;
  current_performance: string;
  strengths: string;
  impact_of_disability: string;
  start_line: number;
  end_line: number;
}

export interface AccommodationsBlock {
  description: string;
  contexts: Record<string, AccommodationContext>;
}

export interface AccommodationContext {
  description: string;
  presentation_of_instruction: AccommodationItem[];
  response: AccommodationItem[];
  timing_and_scheduling: AccommodationItem[];
  setting_and_environment: AccommodationItem[];
}

export interface AccommodationItem {
  id: string;
  text: string;
}

export interface ModificationsBlock {
  description: string;
  contexts: Record<string, ModificationContext>;
}

export interface ModificationContext {
  description: string;
  content: ModificationItem[];
  instruction: ModificationItem[];
  student_output: ModificationItem[];
}

export interface ModificationItem {
  id: string;
  text: string;
}

export interface ParsedGoal {
  id: string;
  number: number;
  area: string;
  description: string;
  baseline: string;
  annual_target: GoalAnnualTarget;
  benchmarks: BenchmarkItem[];
  progress_reporting?: string;
  full_lines: [number, number];
}

export interface GoalAnnualTarget {
  target?: string;
  criteria?: string;
  method?: string;
  schedule?: string;
  person_responsible?: string;
}

export interface BenchmarkItem {
  id: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Descriptions (paraphrased from the IEP form template)
// ---------------------------------------------------------------------------

const DESC = {
  concerns:
    "What concern(s) do you (parent/student) want this IEP to address?",
  present_levels: {
    academics:
      "Describe the student's present levels of academic achievement and functional performance in the relevant subject areas. Includes current performance, strengths/interests, and impact of disability on involvement in the general education curriculum.",
    behavioral:
      "Describe the student's present levels of behavioral, social, and emotional functioning. Consider positive behavioral interventions and supports, and other strategies to address behavior that impedes learning.",
    communication:
      "Describe the student's present levels of communication. Consider augmentative and alternative communication needs.",
    additional_areas:
      "Describe the student's present levels in additional areas — activities of daily living, health, hearing, motor, sensory, vision.",
  },
  accommodations:
    "Accommodations the student needs to make progress in the areas of academic achievement and functional performance. Accommodations change HOW the student accesses content or responds — same learning expectation as peers.",
  modifications:
    "Modifications, if any, that are needed to the student's program. Modifications change WHAT the student is taught, demonstrates, or is assessed on — different learning expectation than peers. Apply modifications only when the IEP authorizes them.",
  goal:
    "An academic or functional goal designed to address needs resulting from the disability and enable the student to make progress in the general curriculum.",
  context: {
    Classroom:
      "Accommodations/modifications applied during classroom instruction.",
    "Non-Academic Settings":
      "Accommodations/modifications applied during non-academic settings (lunch, recess, etc.).",
    "Extracurricular Activities":
      "Accommodations/modifications applied during extracurricular activities.",
    "Community/Workplace":
      "Accommodations/modifications applied during community or workplace settings.",
  } as Record<string, string>,
} as const;

const DEFAULT_CONTEXT = "Classroom";

// ---------------------------------------------------------------------------
// Section descriptors (for findMarkers)
// ---------------------------------------------------------------------------

interface SectionDescriptor {
  key: string;
  primary: string;
  /**
   * Optional subsection name. When set, the descriptor matches if either
   * (a) the trimmed line ends with this string (case-insensitive), or
   * (b) the next non-empty line starts with this string. Handles both the
   * "PRESENT LEVELS...: ACADEMICS" single-line form and the legacy
   * two-line form.
   */
  subsection?: string;
  /** "exact" matches the full trimmed line; "startsWith" allows suffix. */
  primaryMode?: "exact" | "startsWith";
  /** Sections starting with "_" are markers only — used for slicing, not output. */
}

const SECTION_DESCRIPTORS: SectionDescriptor[] = [
  { key: "student_concerns", primary: "STUDENT AND PARENT CONCERNS" },
  { key: "team_vision", primary: "STUDENT AND TEAM VISION" },
  { key: "student_profile", primary: "STUDENT PROFILE" },
  { key: "pl_academics", primary: "PRESENT LEVELS", primaryMode: "startsWith", subsection: "ACADEMICS" },
  { key: "pl_behavioral", primary: "PRESENT LEVELS", primaryMode: "startsWith", subsection: "BEHAVIORAL" },
  { key: "pl_communication", primary: "PRESENT LEVELS", primaryMode: "startsWith", subsection: "COMMUNICATION" },
  { key: "pl_additional", primary: "PRESENT LEVELS", primaryMode: "startsWith", subsection: "ADDITIONAL AREAS" },
  { key: "accommodations_modifications", primary: "ACCOMMODATIONS AND MODIFICATIONS" },
  { key: "measurable_annual_goals", primary: "MEASURABLE ANNUAL GOALS" },
  { key: "participation", primary: "PARTICIPATION IN THE GENERAL EDUCATION", primaryMode: "startsWith" },
  { key: "service_delivery", primary: "SERVICE DELIVERY" },
  { key: "state_assessments", primary: "STATE AND DISTRICT-WIDE ASSESSMENTS", primaryMode: "startsWith" },
  { key: "additional_information", primary: "ADDITIONAL INFORMATION" },
  { key: "_response_section", primary: "RESPONSE SECTION" },
  { key: "_placement", primary: "PLACEMENT CONSENT FORM" },
];

const PRESENT_LEVEL_KEYS: Record<string, PresentLevelKey> = {
  pl_academics: "academics",
  pl_behavioral: "behavioral",
  pl_communication: "communication",
  pl_additional: "additional_areas",
};

const META_PATTERNS: ReadonlyArray<{ key: keyof ParsedMeta; pattern: RegExp }> = [
  { key: "student_name", pattern: /Full Name:\s*([^\n]+?)\s+(?:Servicing School|SASID|ID#)/ },
  { key: "grade", pattern: /Grade Level:\s*([^\n]+)/ },
  { key: "dob", pattern: /Birth Date:\s*([0-9/]+)/ },
  { key: "sasid", pattern: /SASID:\s*([A-Za-z0-9]+)/ },
  { key: "case_manager", pattern: /Special Education Teacher\/Case Manager:\s*([^\n]+)/ },
  { key: "school", pattern: /School Name:\s*([^\n]+?)\s+Telephone:/ },
];

// ---------------------------------------------------------------------------
// Marker / slicing helpers
// ---------------------------------------------------------------------------

interface Marker {
  key: string;
  line: number; // 1-indexed
}

function lineMatches(line: string, descriptor: SectionDescriptor): boolean {
  const upper = line.toUpperCase();
  const primary = descriptor.primary.toUpperCase();
  return descriptor.primaryMode === "startsWith"
    ? upper.startsWith(primary)
    : upper === primary;
}

function subsectionMatches(line: string, next: string, subsection: string): boolean {
  const sub = subsection.toUpperCase();
  return line.toUpperCase().includes(sub) || next.toUpperCase().startsWith(sub);
}

function findMarkers(lines: string[]): Marker[] {
  const markers: Marker[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    if (!cur) continue;
    const next = (lines[i + 1] ?? "").trim();
    for (const d of SECTION_DESCRIPTORS) {
      if (!lineMatches(cur, d)) continue;
      if (d.subsection && !subsectionMatches(cur, next, d.subsection)) continue;
      markers.push({ key: d.key, line: i + 1 });
      break;
    }
  }
  return markers;
}

function nextStartAfter(markers: Marker[], idx: number, totalLines: number): number {
  return markers[idx + 1]?.line ?? totalLines + 1;
}

function sliceLines(lines: string[], startLine: number, endLineExclusive: number): string {
  return lines.slice(startLine - 1, endLineExclusive - 1).join("\n").trim();
}

function findSubLineIndex(
  segment: string[],
  predicate: (line: string) => boolean,
  fromIndex = 0,
): number {
  for (let i = fromIndex; i < segment.length; i++) {
    if (predicate(segment[i])) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Meta + profile
// ---------------------------------------------------------------------------

function extractMeta(rawText: string): ParsedMeta {
  const meta: ParsedMeta = {};
  for (const { key, pattern } of META_PATTERNS) {
    const m = pattern.exec(rawText);
    if (m) (meta[key] as string) = m[1].trim();
  }
  const dates = /IEP Dates:\s*from\s*([0-9/]+)\s*to\s*([0-9/]+)/.exec(rawText);
  if (dates) meta.iep_dates = { from: dates[1], to: dates[2] };
  return meta;
}

function extractProfile(profileText: string | undefined): ParsedProfile {
  const empty: ParsedProfile = {
    disability_categories: [],
    is_english_learner: false,
    requires_at: false,
  };
  if (!profileText) return empty;

  const startMarker = profileText.search(/disability or disabilities[:.]/i);
  const startIdx = startMarker >= 0 ? startMarker : 0;
  const disabilityRegion =
    profileText.slice(startIdx).split(/\n\s*(?:Has the student|Does the student)/i)[0] ?? "";
  const disability_categories = Array.from(
    disabilityRegion.matchAll(/^[\s•·\-*]+\s*(.+?)\s*$/gm),
  )
    .map((m) => m[1].trim())
    .filter(
      (s) =>
        s &&
        !s.toLowerCase().startsWith("disability or disabilities") &&
        !/^[A-Z][a-z]+:$/.test(s),
    );

  const checkedAfter = (anchor: RegExp): boolean => {
    const m = anchor.exec(profileText);
    if (!m) return false;
    const after = profileText.slice(m.index + m[0].length).slice(0, 200);
    const yesIdx = after.search(/☑\s*Yes|:\s*Yes/i);
    const noIdx = after.search(/☑\s*No|:\s*No/i);
    if (yesIdx === -1) return false;
    if (noIdx === -1) return true;
    return yesIdx < noIdx;
  };

  return {
    disability_categories,
    is_english_learner: checkedAfter(/English Learner\?/),
    requires_at: checkedAfter(/assistive technology/),
  };
}

// ---------------------------------------------------------------------------
// Concerns
// ---------------------------------------------------------------------------

function extractConcerns(
  blockText: string | undefined,
  startLine?: number,
  endLine?: number,
): ConcernsBlock | undefined {
  if (!blockText) return undefined;
  const text = blockText
    .replace(/^STUDENT AND PARENT CONCERNS\s*\n?/i, "")
    .replace(/^What concern\(s\) do you want this IEP to address\?\s*\n?/i, "")
    .trim();
  if (!text) return undefined;
  return {
    description: DESC.concerns,
    text,
    start_line: startLine,
    end_line: endLine,
  };
}

// ---------------------------------------------------------------------------
// Present levels
// ---------------------------------------------------------------------------

const PL_LABELS = {
  current_performance: [
    "Briefly describe current performance",
    "Current performance",
    "Briefly describe",
  ],
  strengths: ["Strengths, interest areas, and preferences", "Strengths"],
  impact_of_disability: ["Impact of student's disability", "Impact of the student's disability"],
} as const;

function splitPresentLevel(blockText: string): {
  current_performance: string;
  strengths: string;
  impact_of_disability: string;
} {
  const lines = blockText.split("\n");
  const labelHits: { key: keyof typeof PL_LABELS; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim().replace(/[:—-]+$/, "").trim();
    for (const [key, candidates] of Object.entries(PL_LABELS) as [
      keyof typeof PL_LABELS,
      readonly string[],
    ][]) {
      if (candidates.some((c) => trimmed.toLowerCase().startsWith(c.toLowerCase()))) {
        labelHits.push({ key, line: i });
        break;
      }
    }
  }
  const out = { current_performance: "", strengths: "", impact_of_disability: "" };
  for (let i = 0; i < labelHits.length; i++) {
    const start = labelHits[i].line + 1;
    const end = labelHits[i + 1]?.line ?? lines.length;
    const slice = lines.slice(start, end).join("\n").trim();
    out[labelHits[i].key] = slice;
  }
  return out;
}

function extractPresentLevels(markers: Marker[], lines: string[]): PresentLevelsBlock {
  const out: PresentLevelsBlock = {};
  for (const [markerKey, plKey] of Object.entries(PRESENT_LEVEL_KEYS) as [
    string,
    PresentLevelKey,
  ][]) {
    const idx = markers.findIndex((m) => m.key === markerKey);
    if (idx === -1) continue;
    const start = markers[idx].line;
    const end = nextStartAfter(markers, idx, lines.length);
    const headerLine = lines[start - 1].trim();
    const blockText = sliceLines(lines, start + 1, end);
    const split = splitPresentLevel(blockText);
    out[plKey] = {
      header_text: headerLine,
      description: DESC.present_levels[plKey],
      current_performance: split.current_performance,
      strengths: split.strengths,
      impact_of_disability: split.impact_of_disability,
      start_line: start,
      end_line: end - 1,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Accommodations + modifications
// ---------------------------------------------------------------------------

const ACC_COLUMN_PATTERNS: Record<keyof Omit<AccommodationContext, "description">, RegExp> = {
  presentation_of_instruction: /^(?:presentation(?:\s+of\s+instruction)?)\s*(?:\(([^)]+)\))?\s*:?\s*$/i,
  response: /^response\s*(?:\(([^)]+)\))?\s*:?\s*$/i,
  timing_and_scheduling: /^timing\s*(?:and|and\/or|\/)?\s*scheduling\s*(?:\(([^)]+)\))?\s*:?\s*$/i,
  setting_and_environment: /^setting\s*(?:and|and\/or|\/)?\s*environment\s*(?:\(([^)]+)\))?\s*:?\s*$/i,
};

const MOD_COLUMN_PATTERNS: Record<keyof Omit<ModificationContext, "description">, RegExp> = {
  content: /^content(?:\s+instruction)?\s*:/i,
  instruction: /^instruction\s*:/i,
  student_output: /^(?:student\s+output|output)\s*:/i,
};

const CONTEXT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Classroom", pattern: /^classroom(?:\s+(?:accommodations|modifications))?\s*:?\s*$/i },
  { name: "Non-Academic Settings", pattern: /^non[-\s]academic\s+settings/i },
  { name: "Extracurricular Activities", pattern: /^extracurricular\s+activities/i },
  { name: "Community/Workplace", pattern: /^community\s*\/?\s*workplace/i },
];

function detectContextFromHeader(line: string): string | null {
  const trimmed = line.trim();
  // Inline context in parens: e.g. "Presentation of Instruction (Classroom):".
  // Only return if the parenthesized content matches a KNOWN context — otherwise
  // we'd swallow incidental parens like "Small group (as needed)".
  const paren = /\(([^)]+)\)/.exec(trimmed);
  if (paren) {
    const ctx = paren[1].trim();
    for (const { name, pattern } of CONTEXT_PATTERNS) {
      if (pattern.test(ctx) || ctx.toLowerCase() === name.toLowerCase()) return name;
    }
    // Unknown content in parens — not a context.
  }
  // Standalone context line
  for (const { name, pattern } of CONTEXT_PATTERNS) {
    if (pattern.test(trimmed)) return name;
  }
  return null;
}

function emptyAccContext(name: string): AccommodationContext {
  return {
    description: DESC.context[name] ?? `Accommodations applied in ${name}.`,
    presentation_of_instruction: [],
    response: [],
    timing_and_scheduling: [],
    setting_and_environment: [],
  };
}

function emptyModContext(name: string): ModificationContext {
  return {
    description: DESC.context[name] ?? `Modifications applied in ${name}.`,
    content: [],
    instruction: [],
    student_output: [],
  };
}

function makeId(prefix: string, contextName: string, ordinal: number): string {
  const ctxSlug = contextName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${prefix}-${ctxSlug}-${String(ordinal).padStart(2, "0")}`;
}

function bulletItem(line: string): string | null {
  const m = /^\s*[-•·*]\s+(.+)$/.exec(line);
  return m ? m[1].trim() : null;
}

function parseAccommodations(blockText: string): Record<string, AccommodationContext> {
  const lines = blockText.split("\n");
  const contexts: Record<string, AccommodationContext> = {};
  let currentContext = DEFAULT_CONTEXT;
  let currentColumn: keyof Omit<AccommodationContext, "description"> | null = null;
  const counters = new Map<string, number>();
  const next = (ctx: string): number => {
    const n = (counters.get(ctx) ?? 0) + 1;
    counters.set(ctx, n);
    return n;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      currentColumn = null;
      continue;
    }
    if (/^accommodations\s*:?\s*$/i.test(line)) continue;
    if (/^modifications\s*:?\s*$/i.test(line)) break; // accommodations end here

    // Bullet items are always items — check this BEFORE header detection so
    // incidental parens in items (e.g. "Small group (as needed)") don't get
    // misread as context headers.
    const item = bulletItem(line);
    if (item) {
      if (currentColumn) {
        const ctx = (contexts[currentContext] ??= emptyAccContext(currentContext));
        ctx[currentColumn].push({
          id: makeId(`acc-${currentColumn.replace(/_/g, "-")}`, currentContext, next(`${currentContext}|${currentColumn}`)),
          text: item,
        });
      }
      continue;
    }

    // Column header (with optional context in parens)
    let matched = false;
    for (const [colKey, regex] of Object.entries(ACC_COLUMN_PATTERNS) as [
      keyof Omit<AccommodationContext, "description">,
      RegExp,
    ][]) {
      const m = regex.exec(line);
      if (!m) continue;
      const inlineCtx = m[1] ? m[1].trim() : null;
      if (inlineCtx) {
        const ctxName = CONTEXT_PATTERNS.find((c) => c.pattern.test(inlineCtx))?.name ?? inlineCtx;
        currentContext = ctxName;
      }
      currentColumn = colKey;
      if (!contexts[currentContext]) contexts[currentContext] = emptyAccContext(currentContext);
      matched = true;
      break;
    }
    if (matched) continue;

    // Standalone context line ("Classroom:")
    const ctxOnly = detectContextFromHeader(line);
    if (ctxOnly) {
      currentContext = ctxOnly;
      currentColumn = null;
      if (!contexts[currentContext]) contexts[currentContext] = emptyAccContext(currentContext);
    }
  }
  return contexts;
}

function parseModifications(blockText: string): Record<string, ModificationContext> {
  const lines = blockText.split("\n");
  const contexts: Record<string, ModificationContext> = {};
  let currentContext = DEFAULT_CONTEXT;
  const counters = new Map<string, number>();
  const next = (key: string): number => {
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return n;
  };

  let started = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^modifications\s*:?\s*$/i.test(line)) {
      started = true;
      continue;
    }
    if (!started) continue;

    const ctxOnly = detectContextFromHeader(line);
    const isItem = !!bulletItem(line);
    if (ctxOnly && !isItem) {
      currentContext = ctxOnly;
      if (!contexts[currentContext]) contexts[currentContext] = emptyModContext(currentContext);
      continue;
    }

    const item = bulletItem(line);
    if (!item) continue;
    if (!contexts[currentContext]) contexts[currentContext] = emptyModContext(currentContext);

    // Try to detect labeled column: "Content: <text>" / "Instruction: <text>" / "Student Output: <text>".
    let assigned: keyof Omit<ModificationContext, "description"> | null = null;
    let payload = item;
    for (const [colKey, regex] of Object.entries(MOD_COLUMN_PATTERNS) as [
      keyof Omit<ModificationContext, "description">,
      RegExp,
    ][]) {
      const m = regex.exec(item);
      if (m) {
        assigned = colKey;
        payload = item.slice(m[0].length).trim();
        break;
      }
    }
    if (!assigned) {
      // Default to content if no column label
      assigned = "content";
    }
    contexts[currentContext][assigned].push({
      id: makeId(`mod-${assigned.replace(/_/g, "-")}`, currentContext, next(`${currentContext}|${assigned}`)),
      text: payload,
    });
  }
  return contexts;
}

function extractAccommodationsAndModifications(
  blockText: string | undefined,
): { accommodations?: AccommodationsBlock; modifications?: ModificationsBlock } {
  if (!blockText) return {};
  const accContexts = parseAccommodations(blockText);
  const modContexts = parseModifications(blockText);
  const result: ReturnType<typeof extractAccommodationsAndModifications> = {};
  if (Object.keys(accContexts).length > 0) {
    result.accommodations = {
      description: DESC.accommodations,
      contexts: accContexts,
    };
  }
  if (Object.keys(modContexts).length > 0) {
    result.modifications = {
      description: DESC.modifications,
      contexts: modContexts,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

const GOAL_FIELD_LABELS: Array<{
  key: keyof GoalAnnualTarget;
  needles: string[];
}> = [
  { key: "target", needles: ["Annual Goal/Target", "Annual Goal", "Goal/Target"] },
  { key: "criteria", needles: ["Criteria"] },
  { key: "method", needles: ["Method"] },
  { key: "schedule", needles: ["Schedule"] },
  { key: "person_responsible", needles: ["Person Responsible", "Person(s) Responsible"] },
];

function parseInlineLabel(line: string, needles: string[]): string | null {
  const trimmed = line.trim();
  for (const n of needles) {
    const re = new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.*)$`, "i");
    const m = re.exec(trimmed);
    if (m) return m[1].trim();
  }
  return null;
}

function lineIsAnyOf(line: string, all: ReadonlyArray<{ needles: readonly string[] }>): boolean {
  return all.some(({ needles }) =>
    needles.some((n) => parseInlineLabel(line, [n]) !== null),
  );
}

function extractGoalAnnualTarget(segment: string[], targetStartIdx: number, endIdx: number): {
  target: GoalAnnualTarget;
  baselineEndIdx: number;
} {
  const target: GoalAnnualTarget = {};
  for (let i = targetStartIdx; i < endIdx; i++) {
    for (const { key, needles } of GOAL_FIELD_LABELS) {
      const v = parseInlineLabel(segment[i], needles);
      if (v !== null) {
        target[key] = v;
        break;
      }
    }
  }
  return { target, baselineEndIdx: targetStartIdx };
}

function extractBenchmarks(segment: string[], startIdx: number, endIdx: number, goalNumber: number): BenchmarkItem[] {
  const items: BenchmarkItem[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const item = bulletItem(segment[i]);
    if (item) {
      items.push({
        id: `bench-${goalNumber}-${String(items.length + 1).padStart(2, "0")}`,
        text: item,
      });
    } else if (items.length > 0 && segment[i].trim()) {
      // Continuation of previous bullet (wrapped line)
      items[items.length - 1].text += " " + segment[i].trim();
    }
  }
  return items;
}

function extractGoals(markers: Marker[], lines: string[]): ParsedGoal[] {
  const goalSections = markers.filter((m) => m.key === "measurable_annual_goals");
  if (goalSections.length === 0) return [];

  const firstStart = goalSections[0].line;
  const lastStart = goalSections[goalSections.length - 1].line;
  const sectionEnd =
    markers.find((m) => m.line > lastStart && m.key !== "measurable_annual_goals")?.line ??
    lines.length + 1;

  const goalStarts: number[] = [];
  for (let i = firstStart - 1; i < sectionEnd - 1; i++) {
    if (lines[i].trim().startsWith("Goal Area")) goalStarts.push(i + 1);
  }

  const goals: ParsedGoal[] = [];
  for (let g = 0; g < goalStarts.length; g++) {
    const start = goalStarts[g];
    const end = goalStarts[g + 1] ?? sectionEnd;
    const segment = lines.slice(start - 1, end - 1);

    // Extract the goal area name. Reject single-character or punctuation-only
    // matches so trash like ":" can never leak through. Fall back to the next
    // non-blank line if the header line doesn't carry a real word.
    const isValidArea = (s: string): boolean => /[A-Za-z]{2,}/.test(s);
    const goalAreaLine = segment[0].trim();
    let number = g + 1;
    let area = "";

    // Inline form: "Goal Area 1 - Counseling" — requires a separator.
    const inlineMatch = /Goal\s*Area\s*:?\s*(\d+)?\s*[-–:]\s*(.+)$/i.exec(goalAreaLine);
    if (inlineMatch && isValidArea(inlineMatch[2] ?? "")) {
      number = inlineMatch[1] ? parseInt(inlineMatch[1], 10) : g + 1;
      area = inlineMatch[2].trim();
    } else {
      let j = 1;
      while (j < segment.length && segment[j].trim() === "") j++;
      const nextLine = segment[j]?.trim() ?? "";
      const numbered = /^(\d+)\s*[-–:]\s*(.+)$/.exec(nextLine);
      if (numbered && isValidArea(numbered[2])) {
        number = parseInt(numbered[1], 10);
        area = numbered[2].trim();
      } else if (isValidArea(nextLine)) {
        area = nextLine;
      } else {
        area = `Goal ${number}`;
      }
    }

    const baselineIdx = findSubLineIndex(segment, (l) => /^baseline\s*:/i.test(l.trim()));
    const targetIdx = findSubLineIndex(segment, (l) =>
      lineIsAnyOf(l, [GOAL_FIELD_LABELS[0]]),
    );
    const stoIdx = findSubLineIndex(segment, (l) =>
      /^short[-\s]?term\s+objectives?(?:\/benchmarks?)?\s*:?/i.test(l.trim()),
    );
    const reportingIdx = findSubLineIndex(segment, (l) =>
      /^schedule of progress reporting\s*:?/i.test(l.trim()),
    );

    if (baselineIdx === -1) continue;

    // Baseline content: same line after the colon, plus continuation until target
    const baselineLine = segment[baselineIdx];
    const baselineInline = parseInlineLabel(baselineLine, ["Baseline"]);
    const baselineSliceEnd = targetIdx !== -1 ? targetIdx : (stoIdx !== -1 ? stoIdx : segment.length);
    const baselineRest = segment
      .slice(baselineIdx + 1, baselineSliceEnd)
      .filter((l) => l.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const baseline = [baselineInline ?? "", baselineRest]
      .filter((s) => s)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // Annual target fields
    const targetEnd = stoIdx !== -1 ? stoIdx : (reportingIdx !== -1 ? reportingIdx : segment.length);
    const annual_target =
      targetIdx === -1
        ? {}
        : extractGoalAnnualTarget(segment, targetIdx, targetEnd).target;

    // Benchmarks
    const benchStart = stoIdx !== -1 ? stoIdx + 1 : -1;
    const benchEnd = reportingIdx !== -1 ? reportingIdx : segment.length;
    const benchmarks =
      benchStart === -1 ? [] : extractBenchmarks(segment, benchStart, benchEnd, number);

    // Progress reporting
    const progress_reporting =
      reportingIdx === -1
        ? undefined
        : (parseInlineLabel(segment[reportingIdx], ["Schedule of Progress Reporting"]) ??
           segment.slice(reportingIdx + 1).filter((l) => l.trim()).join(" ").trim()) || undefined;

    goals.push({
      id: `goal-${number}`,
      number,
      area,
      description: DESC.goal,
      baseline,
      annual_target,
      benchmarks,
      progress_reporting,
      full_lines: [start, end - 1],
    });
  }

  return goals;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseIep(rawText: string): ParsedIep {
  const lines = rawText.split("\n");
  const markers = findMarkers(lines);

  const meta = extractMeta(rawText);

  // Concerns block
  const concernsIdx = markers.findIndex((m) => m.key === "student_concerns");
  let concerns: ConcernsBlock | undefined;
  if (concernsIdx !== -1) {
    const start = markers[concernsIdx].line;
    const end = nextStartAfter(markers, concernsIdx, lines.length);
    concerns = extractConcerns(sliceLines(lines, start, end), start, end - 1);
  }

  // Profile block
  const profileIdx = markers.findIndex((m) => m.key === "student_profile");
  const profileText =
    profileIdx === -1
      ? undefined
      : sliceLines(lines, markers[profileIdx].line, nextStartAfter(markers, profileIdx, lines.length));
  const profile = extractProfile(profileText);

  // Present levels
  const present_levels = extractPresentLevels(markers, lines);

  // Accommodations + modifications
  const accModIdx = markers.findIndex((m) => m.key === "accommodations_modifications");
  const accModText =
    accModIdx === -1
      ? undefined
      : sliceLines(
          lines,
          markers[accModIdx].line,
          nextStartAfter(markers, accModIdx, lines.length),
        );
  const { accommodations, modifications } = extractAccommodationsAndModifications(accModText);

  // Goals
  const goals = extractGoals(markers, lines);

  // Anchor diagnostics
  const allKeys = SECTION_DESCRIPTORS.filter((d) => !d.key.startsWith("_")).map((d) => d.key);
  const foundKeys = new Set(markers.map((m) => m.key));
  const anchors_found = allKeys.filter((k) => foundKeys.has(k));
  const anchors_missing = allKeys.filter((k) => !foundKeys.has(k));

  return {
    meta,
    concerns,
    present_levels,
    profile,
    accommodations,
    modifications,
    goals,
    anchors_found,
    anchors_missing,
  };
}
