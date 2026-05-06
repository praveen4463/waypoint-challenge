/**
 * Parses raw IEP text deterministically into a structured object.
 */

export interface ParsedIep {
  meta: ParsedMeta;
  sections: Record<string, SectionBlock | undefined>;
  present_levels: Record<PresentLevelKey, SectionBlock | undefined>;
  profile: ParsedProfile;
  goals: ParsedGoal[];
  raw_text: string;
  /** Diagnostics for upload-time echo: which anchors were found / missing. */
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

export interface SectionBlock {
  text: string;
  start_line: number;
  end_line: number;
}

export type PresentLevelKey =
  | "academics"
  | "behavioral"
  | "communication"
  | "additional_areas";

export interface ParsedGoal {
  id: string;
  number: number;
  area: string;
  baseline: SectionBlock;
  annual_target: SectionBlock;
  benchmarks: SectionBlock;
  progress_reporting?: SectionBlock;
  full_lines: [number, number];
}

// ---------------------------------------------------------------------------
// Section descriptors
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

// Header matching is case-insensitive to tolerate caller variations
// (e.g., "Participation..." vs "PARTICIPATION...", same content).
// We additionally accept the original two-line form (header + sub-header)
// where the next line carries the subsection name, OR a single-line form
// where the subsection name is appended after a colon.
const SECTION_DESCRIPTORS: SectionDescriptor[] = [
  { key: "student_concerns", primary: "STUDENT AND PARENT CONCERNS" },
  { key: "team_vision", primary: "STUDENT AND TEAM VISION" },
  { key: "student_profile", primary: "STUDENT PROFILE" },
  // Present Levels: match the long form ("PRESENT LEVELS OF ACADEMIC ACHIEVEMENT
  // AND FUNCTIONAL PERFORMANCE: ACADEMICS") or any compacted form
  // ("PRESENT LEVELS: BEHAVIORAL/SOCIAL/EMOTIONAL"). Subsection disambiguates.
  {
    key: "pl_academics",
    primary: "PRESENT LEVELS",
    primaryMode: "startsWith",
    subsection: "ACADEMICS",
  },
  {
    key: "pl_behavioral",
    primary: "PRESENT LEVELS",
    primaryMode: "startsWith",
    subsection: "BEHAVIORAL",
  },
  {
    key: "pl_communication",
    primary: "PRESENT LEVELS",
    primaryMode: "startsWith",
    subsection: "COMMUNICATION",
  },
  {
    key: "pl_additional",
    primary: "PRESENT LEVELS",
    primaryMode: "startsWith",
    subsection: "ADDITIONAL AREAS",
  },
  {
    key: "accommodations_modifications",
    primary: "ACCOMMODATIONS AND MODIFICATIONS",
  },
  { key: "measurable_annual_goals", primary: "MEASURABLE ANNUAL GOALS" },
  {
    key: "participation",
    primary: "PARTICIPATION IN THE GENERAL EDUCATION",
    primaryMode: "startsWith",
  },
  { key: "service_delivery", primary: "SERVICE DELIVERY" },
  {
    key: "state_assessments",
    primary: "STATE AND DISTRICT-WIDE ASSESSMENTS",
    primaryMode: "startsWith",
  },
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

const META_PATTERNS: ReadonlyArray<{ key: keyof ParsedMeta; pattern: RegExp }> =
  [
    {
      key: "student_name",
      pattern: /Full Name:\s*([^\n]+?)\s+(?:Servicing School|SASID|ID#)/,
    },
    { key: "grade", pattern: /Grade Level:\s*([^\n]+)/ },
    { key: "dob", pattern: /Birth Date:\s*([0-9/]+)/ },
    { key: "sasid", pattern: /SASID:\s*([A-Za-z0-9]+)/ },
    {
      key: "case_manager",
      pattern: /Special Education Teacher\/Case Manager:\s*([^\n]+)/,
    },
    { key: "school", pattern: /School Name:\s*([^\n]+?)\s+Telephone:/ },
  ];

// In-goal anchors. Match both the legacy column-based form and the
// compact single-line form Claude Desktop tends to produce
// (e.g., "Goal Area 1 - Counseling", "Baseline:", "Annual Goal/Target: ...").
const GOAL_ANCHORS = [
  { key: "goal_area", needle: "Goal Area", mode: "startsWith" as const },
  { key: "baseline", needle: "Baseline", mode: "startsWith" as const },
  {
    key: "annual_target",
    needle: "Annual Goal/Target",
    mode: "startsWith" as const,
  },
  {
    key: "short_term",
    needle: "Short-term objectives",
    mode: "startsWith" as const,
  },
  {
    key: "progress_reporting",
    needle: "Schedule of Progress Reporting",
    mode: "startsWith" as const,
  },
];

// ---------------------------------------------------------------------------
// Helpers
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

function subsectionMatches(
  line: string,
  next: string,
  subsection: string,
): boolean {
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

function blockBetween(
  lines: string[],
  startLine: number,
  endLineExclusive: number,
): SectionBlock {
  const text = lines
    .slice(startLine - 1, endLineExclusive - 1)
    .join("\n")
    .trim();
  return { text, start_line: startLine, end_line: endLineExclusive - 1 };
}

function sectionFor(
  markers: Marker[],
  key: string,
  lines: string[],
): SectionBlock | undefined {
  const idx = markers.findIndex((m) => m.key === key);
  if (idx === -1) return undefined;
  const start = markers[idx].line;
  const end = markers[idx + 1]?.line ?? lines.length + 1;
  return blockBetween(lines, start, end);
}

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

function extractProfile(profileBlock: SectionBlock | undefined): ParsedProfile {
  const empty: ParsedProfile = {
    disability_categories: [],
    is_english_learner: false,
    requires_at: false,
  };
  if (!profileBlock) return empty;
  const text = profileBlock.text;

  // Disability bullets appear right under the "disability or disabilities"
  // sentence and end before the next checkbox-question line. Restrict the
  // search window to avoid swallowing the whole profile block.
  const startMarker = text.search(/disability or disabilities[:.]/i);
  const startIdx = startMarker >= 0 ? startMarker : 0;
  const disabilityRegion =
    text
      .slice(startIdx)
      .split(/\n\s*(?:Has the student|Does the student)/i)[0] ?? "";
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
    const m = anchor.exec(text);
    if (!m) return false;
    const after = text.slice(m.index + m[0].length).slice(0, 200);
    const yesIdx = after.search(/☑\s*Yes/);
    const noIdx = after.search(/☑\s*No/);
    if (yesIdx === -1 && noIdx === -1) return false;
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

function extractGoals(markers: Marker[], lines: string[]): ParsedGoal[] {
  const goalSections = markers.filter(
    (m) => m.key === "measurable_annual_goals",
  );
  if (goalSections.length === 0) return [];

  // Bound the search range: from the first MEASURABLE ANNUAL GOALS marker
  // to the next non-goal section after the last one. This handles both the
  // legacy form (one MAG header per goal) and the compact form (one MAG
  // header containing multiple "Goal Area" blocks).
  const firstStart = goalSections[0].line;
  const lastStart = goalSections[goalSections.length - 1].line;
  const sectionEnd =
    markers.find(
      (m) => m.line > lastStart && m.key !== "measurable_annual_goals",
    )?.line ?? lines.length + 1;

  // Find every "Goal Area" anchor inside that range.
  const goalStarts: number[] = [];
  for (let i = firstStart - 1; i < sectionEnd - 1; i++) {
    if (lines[i].trim().startsWith("Goal Area")) goalStarts.push(i + 1);
  }

  const goals: ParsedGoal[] = [];
  for (let g = 0; g < goalStarts.length; g++) {
    const start = goalStarts[g];
    const end = goalStarts[g + 1] ?? sectionEnd;
    const segment = lines.slice(start - 1, end - 1);

    const find = (anchor: (typeof GOAL_ANCHORS)[number]): number => {
      for (let j = 0; j < segment.length; j++) {
        if (segment[j].trim().startsWith(anchor.needle)) return j;
      }
      return -1;
    };
    const ix = Object.fromEntries(GOAL_ANCHORS.map((a) => [a.key, find(a)]));

    // The compact form puts "Annual Goal/Target:" inline as a labeled field
    // rather than a header. We only require Goal Area + Baseline + something
    // resembling benchmarks (short_term anchor) to consider it a goal.
    if (ix.goal_area === -1 || ix.baseline === -1) continue;

    // Extract the goal area name. Reject single-character or punctuation-only
    // matches so trash like ":" can never leak through. Fall back to the next
    // non-blank line if the header line doesn't carry a real word.
    const isValidArea = (s: string): boolean => /[A-Za-z]{2,}/.test(s);

    const goalAreaLine = segment[ix.goal_area].trim();
    let number = g + 1;
    let area = "";

    // Inline form: "Goal Area 1 - Counseling" — requires a separator.
    const inlineMatch = /Goal\s*Area\s*:?\s*(\d+)?\s*[-–:]\s*(.+)$/i.exec(
      goalAreaLine,
    );
    if (inlineMatch && isValidArea(inlineMatch[2] ?? "")) {
      number = inlineMatch[1] ? parseInt(inlineMatch[1], 10) : g + 1;
      area = inlineMatch[2].trim();
    } else {
      // Two-line form: header is "Goal Area:" and the area is on a later line.
      let j = ix.goal_area + 1;
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

    const slice = (from: number, to: number): SectionBlock =>
      blockBetween(lines, start + from, start + to);

    // Determine slice boundaries depending on which anchors landed.
    const targetStart =
      ix.annual_target === -1 ? ix.baseline + 1 : ix.annual_target;
    const benchmarksStart =
      ix.short_term === -1
        ? ix.annual_target === -1
          ? ix.baseline + 1
          : ix.annual_target + 1
        : ix.short_term + 1;
    const benchmarksEnd =
      ix.progress_reporting === -1 ? segment.length + 1 : ix.progress_reporting;

    goals.push({
      id: `goal-${number}`,
      number,
      area,
      baseline: slice(ix.baseline + 1, targetStart),
      annual_target: slice(
        targetStart,
        ix.short_term === -1 ? benchmarksEnd : ix.short_term,
      ),
      benchmarks: slice(benchmarksStart, benchmarksEnd),
      progress_reporting:
        ix.progress_reporting === -1
          ? undefined
          : slice(ix.progress_reporting + 1, segment.length + 1),
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

  const sections: Record<string, SectionBlock | undefined> = {};
  for (const d of SECTION_DESCRIPTORS) {
    if (d.key.startsWith("_")) continue;
    if (PRESENT_LEVEL_KEYS[d.key]) continue;
    if (d.key === "measurable_annual_goals") continue;
    sections[d.key] = sectionFor(markers, d.key, lines);
  }

  const present_levels: Record<PresentLevelKey, SectionBlock | undefined> = {
    academics: undefined,
    behavioral: undefined,
    communication: undefined,
    additional_areas: undefined,
  };
  for (const [markerKey, plKey] of Object.entries(PRESENT_LEVEL_KEYS)) {
    present_levels[plKey] = sectionFor(markers, markerKey, lines);
  }

  const allKeys = SECTION_DESCRIPTORS.filter((d) => !d.key.startsWith("_")).map(
    (d) => d.key,
  );
  const foundKeys = new Set(markers.map((m) => m.key));
  const anchors_found = allKeys.filter((k) => foundKeys.has(k));
  const anchors_missing = allKeys.filter((k) => !foundKeys.has(k));

  return {
    meta: extractMeta(rawText),
    sections,
    present_levels,
    profile: extractProfile(sections.student_profile),
    goals: extractGoals(markers, lines),
    raw_text: rawText,
    anchors_found,
    anchors_missing,
  };
}
