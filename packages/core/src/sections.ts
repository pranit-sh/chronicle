import { slugify } from "./ids.js";

const FENCE = /^\s*(```|~~~)/;
const H2 = /^##\s+(.+?)\s*$/;

/**
 * Splits a Markdown body on H2 headings, keyed by slugified heading text.
 * Decisions use this to expose `## Decision`, `## Rationale`, `## Alternatives`
 * and `## Consequences` as structured fields without inventing a second format.
 */
export function extractSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let currentKey: string | undefined;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (currentKey) {
      const content = buffer.join("\n").trim();
      if (content) sections[currentKey] = content;
    }
    buffer = [];
  };

  for (const line of body.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      continue;
    }
    const heading = inFence ? null : H2.exec(line);
    if (heading?.[1]) {
      flush();
      currentKey = slugify(heading[1]);
      continue;
    }
    if (currentKey) buffer.push(line);
  }
  flush();
  return sections;
}

/** The lead paragraph, used as a one line summary in listings and packages. */
export function leadParagraph(body: string): string {
  let inFence = false;
  const paragraph: string[] = [];
  for (const line of body.split("\n")) {
    if (FENCE.test(line)) {
      if (paragraph.length) break;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  return paragraph.join(" ");
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}\u2026`;
}
