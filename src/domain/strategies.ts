// Tag-based retrieval over the curated library. Files whose applies_to
// tags overlap with any requested tag are returned, sorted by overlap
// count (most relevant first).

import { loadCuratedLibrary, type LoadedCuratedFile } from "./catalog.js";

export interface StrategyMatch extends LoadedCuratedFile {
  matched_tags: string[];
}

function fileTags(file: LoadedCuratedFile): string[] {
  const at = file.data.applies_to ?? {};
  return [
    ...(at.cognitive_deficits ?? []),
    ...(at.achievement_deficits ?? []),
    ...(at.contexts ?? []),
    ...(at.profiles ?? []),
  ];
}

export function getStrategies(tags: string[]): StrategyMatch[] {
  if (tags.length === 0) return [];
  const requested = new Set(tags);
  const matches: StrategyMatch[] = [];
  for (const file of loadCuratedLibrary()) {
    const overlap = fileTags(file).filter((t) => requested.has(t));
    if (overlap.length === 0) continue;
    matches.push({
      relative_path: file.relative_path,
      data: file.data,
      matched_tags: Array.from(new Set(overlap)),
    });
  }
  matches.sort((a, b) => b.matched_tags.length - a.matched_tags.length);
  return matches;
}
