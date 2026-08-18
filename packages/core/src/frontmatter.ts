import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const DELIMITER = "---";

export interface MarkdownDocument {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Frontmatter keys are written in this order so that hand edits and generated
 * writes produce the same file, keeping Git diffs limited to real changes.
 */
const KEY_ORDER = [
  "id",
  "type",
  "title",
  "status",
  "enforcement",
  "decisionStatus",
  "severity",
  "lifetime",
  "expiresAt",
  "scopes",
  "paths",
  "tags",
  "stack",
  "source",
  "confidence",
  "priority",
  "pinned",
  "createdAt",
  "updatedAt",
  "lastVerifiedAt",
  "actor",
  "supersedes",
  "supersededBy",
  "relatedTo",
  "workaround",
  "provenance",
  "evidence",
];

export function parseMarkdownDocument(raw: string): MarkdownDocument {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith(`${DELIMITER}\n`)) {
    return { data: {}, body: text.trim() };
  }
  const lines = text.split("\n");
  const closingIndex = lines.findIndex((line, index) => index > 0 && (line === DELIMITER || line === "..."));
  if (closingIndex === -1) {
    return { data: {}, body: text.trim() };
  }
  const yamlSource = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n").trim();
  const parsed = yamlSource.trim() ? parseYaml(yamlSource) : {};
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("frontmatter must be a YAML mapping");
  }
  return { data: parsed as Record<string, unknown>, body };
}

export function orderFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (key in data) ordered[key] = data[key];
  }
  for (const key of Object.keys(data).sort()) {
    if (!(key in ordered)) ordered[key] = data[key];
  }
  return ordered;
}

export function serializeMarkdownDocument(data: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(orderFrontmatter(data), { lineWidth: 0, nullStr: "null" });
  const trimmedBody = body.trim();
  return `${DELIMITER}\n${yaml}${DELIMITER}\n${trimmedBody ? `\n${trimmedBody}\n` : ""}`;
}
