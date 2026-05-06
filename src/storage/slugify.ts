export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function personNameToSlug(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return slugify(fullName);
  return slugify(`${parts[0]} ${parts[parts.length - 1]}`);
}
