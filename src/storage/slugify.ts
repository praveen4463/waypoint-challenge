/**
 * Lowercase, kebab-case, ASCII-safe slug. Strips diacritics and collapses
 * runs of non-alphanumeric characters into a single hyphen.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slug for a person's name. Drops middle name(s) so that
 * "Jasmine Regina Bailey" and "Jasmine Bailey" produce the same slug.
 * If only one word is given, slugifies it as-is.
 */
export function personNameToSlug(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return slugify(fullName);
  return slugify(`${parts[0]} ${parts[parts.length - 1]}`);
}
