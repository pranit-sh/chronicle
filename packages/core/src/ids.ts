import { ulid } from "ulid";

export function newKnowledgeId(): string {
  return `k_${ulid()}`;
}

export function newProposalId(): string {
  return `pr_${ulid()}`;
}

const MAX_SLUG_LENGTH = 64;

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

/** Appends `-2`, `-3`, ... until the slug is free. */
export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${slug}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Resolves a user supplied reference, which may be a full id, an unambiguous id
 * prefix, or a filename slug.
 */
export function matchesReference(reference: string, id: string, slug: string): boolean {
  const needle = reference.trim();
  if (!needle) return false;
  return id === needle || slug === needle || (needle.length >= 4 && id.startsWith(needle));
}
