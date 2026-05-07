// Canonical tag vocabulary for the curated domain library

export const TAG_VOCABULARY = {
  cognitive_deficits: [
    "long-term-retrieval",
    "short-term-memory",
    "processing-speed",
    "auditory-processing",
    "phonemic-awareness",
    "visual-spatial",
    "comprehension-knowledge",
    "fluid-reasoning",
  ],
  achievement_deficits: [
    "basic-reading",
    "reading-comprehension",
    "spelling",
    "basic-math",
    "math-reasoning",
    "penmanship",
    "written-expression",
  ],
  contexts: [
    "environment",
    "transitions",
    "tools-equipment",
    "language-communication",
    "peer-social",
    "sensory",
    "behavior",
    "testing-assessment",
    "instructional-delivery",
  ],
  profiles: [
    "anxiety",
    "executive-function",
    "nvld",
    "adhd-attention",
    "dyslexia",
    "autism",
  ],
} as const;

export type TagCategory = keyof typeof TAG_VOCABULARY;

export const ALL_TAGS: ReadonlySet<string> = new Set(
  Object.values(TAG_VOCABULARY).flat(),
);

export function partitionTags(tags: string[]): {
  valid: string[];
  unknown: string[];
} {
  const valid: string[] = [];
  const unknown: string[] = [];
  for (const t of tags) {
    if (ALL_TAGS.has(t)) valid.push(t);
    else unknown.push(t);
  }
  return { valid, unknown };
}

export function formatTagVocabulary(): string {
  return Object.entries(TAG_VOCABULARY)
    .map(([category, tags]) => `- ${category}: ${tags.join(", ")}`)
    .join("\n");
}
