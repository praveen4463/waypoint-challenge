// Loads the curated domain library from data/domain/curated/ at startup.
// Walks the tree, caches parsed JSONs in memory. Catalog.json files are
// indexes — kept separately from content files.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CURATED_DIR, ROOT_CATALOG } from "../paths.js";

export interface AppliesTo {
  cognitive_deficits?: string[];
  achievement_deficits?: string[];
  contexts?: string[];
  profiles?: string[];
}

// All curated content files share these top-level fields. Item arrays
// (accommodations, instructional_strategies, modifications, techniques,
// key_principles, etc.) vary by file type — we pass them through as-is.
export interface CuratedFile {
  id: string;
  title: string;
  description: string;
  applies_to: AppliesTo;
  source: unknown;
  [key: string]: unknown;
}

export interface LoadedCuratedFile {
  /** Path relative to data/domain/curated/, e.g. "accommodations/by-context/environment.json" */
  relative_path: string;
  data: CuratedFile;
}

let contentCache: LoadedCuratedFile[] | null = null;

function walkContentJsons(dir: string): LoadedCuratedFile[] {
  const out: LoadedCuratedFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkContentJsons(full));
    } else if (entry === "catalog.json") {
      // Skip catalog files
      continue;
    } else if (entry.endsWith(".json")) {
      const data = JSON.parse(readFileSync(full, "utf8")) as CuratedFile;
      out.push({
        relative_path: relative(CURATED_DIR, full),
        data,
      });
    }
  }
  return out;
}

export function loadCuratedLibrary(): LoadedCuratedFile[] {
  if (contentCache) return contentCache;
  contentCache = walkContentJsons(CURATED_DIR);
  return contentCache;
}

export function getRootCatalog(): unknown {
  return JSON.parse(readFileSync(ROOT_CATALOG, "utf8"));
}
