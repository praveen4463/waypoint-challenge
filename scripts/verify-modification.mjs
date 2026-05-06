#!/usr/bin/env node
/**
 * Cross-checks every citation in a Waypoint modification output against
 * the curated library and the registered IEP/lesson data on disk.
 *
 * Usage:
 *   node scripts/verify-modification.mjs path/to/modification.md
 *   pbpaste | node scripts/verify-modification.mjs
 *   node scripts/verify-modification.mjs < modification.md
 *
 * Reports: every cite found, classified as valid / unknown, plus cards
 * (## headings) that lack a `Cite:` line entirely.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURATED_DIR = join(ROOT, "data", "domain", "curated");
const STUDENTS_DIR = join(ROOT, "file-system-db", "indexed", "students");
const LESSONS_DIR = join(ROOT, "file-system-db", "indexed", "lessons");

// ---------------------------------------------------------------------------
// 1. Load every valid identifier from disk into a single Set.
// ---------------------------------------------------------------------------

function walkJson(dir) {
  if (!safeStat(dir)?.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = safeStat(full);
    if (!s) continue;
    if (s.isDirectory()) out.push(...walkJson(full));
    else if (entry.endsWith(".json")) out.push(full);
  }
  return out;
}

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function collectIdsDeep(value, out) {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collectIdsDeep(v, out);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "id" && typeof v === "string") out.add(v);
    if (k === "name" && typeof v === "string" && /^[a-z0-9-]+$/.test(v)) out.add(v);
    collectIdsDeep(v, out);
  }
}

function loadValidIds() {
  const ids = new Set();
  for (const path of walkJson(CURATED_DIR)) {
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      collectIdsDeep(data, ids);
    } catch (e) {
      console.error(`[warn] could not parse ${path}: ${e.message}`);
    }
  }
  for (const path of walkJson(STUDENTS_DIR)) {
    if (!path.endsWith("iep.json")) continue;
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      collectIdsDeep(data, ids);
    } catch (e) {
      console.error(`[warn] could not parse ${path}: ${e.message}`);
    }
  }
  for (const path of walkJson(LESSONS_DIR)) {
    if (!path.endsWith("lesson.json")) continue;
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      collectIdsDeep(data, ids);
    } catch (e) {
      console.error(`[warn] could not parse ${path}: ${e.message}`);
    }
  }
  return ids;
}

function loadFileLineCounts() {
  // For text-anchored citations like `iep.txt L267-280` we need to know
  // each .raw.txt file's line count to validate the range is in bounds.
  const counts = new Map();
  for (const studentDir of safeReaddir(STUDENTS_DIR)) {
    const raw = join(STUDENTS_DIR, studentDir, "iep.raw.txt");
    if (safeStat(raw)?.isFile()) {
      counts.set(`${studentDir}/iep.txt`, lineCount(raw));
      counts.set("iep.txt", lineCount(raw)); // unscoped alias
    }
  }
  for (const lessonDir of safeReaddir(LESSONS_DIR)) {
    const raw = join(LESSONS_DIR, lessonDir, "lesson.raw.txt");
    if (safeStat(raw)?.isFile()) {
      counts.set(`${lessonDir}/lesson.txt`, lineCount(raw));
      counts.set("lesson.txt", lineCount(raw)); // unscoped alias
      counts.set(`${lessonDir.split("-").slice(0, 2).join("-")}.txt`, lineCount(raw));
    }
  }
  // Common short forms
  counts.set("lesson-1.txt", counts.get("lesson.txt"));
  counts.set("lesson-2.txt", counts.get("lesson.txt"));
  return counts;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function lineCount(path) {
  return readFileSync(path, "utf8").split("\n").length;
}

// ---------------------------------------------------------------------------
// 2. Parse the input markdown for citations and per-card structure.
// ---------------------------------------------------------------------------

function parseDocument(text) {
  // Split into cards by markdown headings (## or ###).
  const lines = text.split("\n");
  const cards = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,4}\s+/.test(line)) {
      if (current) cards.push(current);
      current = { title: line.replace(/^#+\s+/, "").trim(), startLine: i + 1, body: [], cite: null, type: null };
    } else if (current) {
      const citeMatch = /^\s*Cite\s*:\s*(.+?)\s*$/i.exec(line);
      const typeMatch = /^\s*Type\s*:\s*(Accommodation|Modification)\b/i.exec(line);
      if (citeMatch) current.cite = citeMatch[1];
      if (typeMatch) current.type = typeMatch[1];
      current.body.push(line);
    }
  }
  if (current) cards.push(current);
  return cards;
}

function splitCites(cite) {
  return cite
    .split(/[·•|;,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ID_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const TEXT_REF_PATTERN = /^([\w./-]+\.txt)\s+L(\d+)(?:[\s\-–]+(\d+))?$/i;

function classifyCite(token, validIds, fileLineCounts) {
  // Strip any markdown/quotation/punctuation noise.
  const cleaned = token.replace(/[`"'()[\]]/g, "").trim();
  if (!cleaned) return { token, valid: false, reason: "empty" };

  // Text-anchored reference: "iep.txt L267-280" or "lesson-1.txt L163"
  const ref = TEXT_REF_PATTERN.exec(cleaned);
  if (ref) {
    const file = ref[1];
    const start = parseInt(ref[2], 10);
    const end = ref[3] ? parseInt(ref[3], 10) : start;
    const total = fileLineCounts.get(file);
    if (total === undefined) {
      return { token, valid: false, reason: `unknown file: ${file}` };
    }
    if (start < 1 || end > total) {
      return { token, valid: false, reason: `line range out of bounds (file has ${total} lines)` };
    }
    return { token, valid: true, kind: "text-ref", file, range: [start, end] };
  }

  // Stable ID — match against the loaded ID set.
  if (ID_PATTERN.test(cleaned) && validIds.has(cleaned)) {
    return { token, valid: true, kind: "id", id: cleaned };
  }

  return { token, valid: false, reason: "id not found in registry" };
}

// ---------------------------------------------------------------------------
// 3. Run + report.
// ---------------------------------------------------------------------------

function readInput() {
  const arg = process.argv[2];
  if (arg && arg !== "-") return readFileSync(arg, "utf8");
  return readFileSync(0, "utf8");
}

function main() {
  const text = readInput();
  const validIds = loadValidIds();
  const fileLineCounts = loadFileLineCounts();
  const cards = parseDocument(text);

  let totalCites = 0;
  let validCites = 0;
  const unknown = [];
  const cardsWithoutCite = [];
  const cardsWithoutType = [];

  for (const card of cards) {
    if (!card.cite) {
      cardsWithoutCite.push(`L${card.startLine}: ${card.title}`);
    }
    if (card.cite && !card.type) {
      cardsWithoutType.push(`L${card.startLine}: ${card.title}`);
    }
    if (!card.cite) continue;
    const tokens = splitCites(card.cite);
    for (const t of tokens) {
      totalCites++;
      const result = classifyCite(t, validIds, fileLineCounts);
      if (result.valid) validCites++;
      else unknown.push({ card: card.title, ...result });
    }
  }

  console.log(`Cards detected: ${cards.length}`);
  console.log(`Cards with Cite line: ${cards.length - cardsWithoutCite.length}`);
  console.log(`Cards missing Cite line: ${cardsWithoutCite.length}`);
  if (cardsWithoutCite.length) {
    for (const c of cardsWithoutCite) console.log(`  - ${c}`);
  }

  console.log(`\nCards with Type: ${cards.length - cardsWithoutCite.length - cardsWithoutType.length} of ${cards.length - cardsWithoutCite.length}`);
  if (cardsWithoutType.length) {
    for (const c of cardsWithoutType) console.log(`  missing Type: ${c}`);
  }

  console.log(`\nCitations parsed: ${totalCites}`);
  console.log(`Citations valid:  ${validCites}`);
  console.log(`Citations unknown: ${unknown.length}`);
  if (unknown.length) {
    console.log(`\nUnknown citations (likely hallucinated):`);
    for (const u of unknown) {
      console.log(`  [${u.card}] ${u.token} — ${u.reason}`);
    }
  }

  const ok = unknown.length === 0 && cardsWithoutCite.length === 0;
  console.log(`\n${ok ? "✓ all citations grounded" : "✗ ungrounded content detected"}`);
  process.exit(ok ? 0 : 1);
}

main();
