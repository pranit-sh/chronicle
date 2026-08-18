import { newKnowledgeId } from "../src/ids.js";
import { extractSections } from "../src/sections.js";
import {
  type ChronicleConfig,
  ChronicleConfigSchema,
  KnowledgeFrontmatterSchema,
  type KnowledgeItem,
} from "../src/schema.js";

/** Builds a valid in-memory knowledge item without touching disk. */
export function makeItem(overrides: Record<string, unknown> = {}): KnowledgeItem {
  const now = new Date().toISOString();
  const { body = "", ...rest } = overrides;
  const frontmatter = KnowledgeFrontmatterSchema.parse({
    id: newKnowledgeId(),
    type: "rule",
    title: "Untitled",
    createdAt: now,
    updatedAt: now,
    actor: { kind: "human", id: "tester" },
    ...rest,
  });
  const text = String(body);
  return {
    ...frontmatter,
    body: text,
    sections: extractSections(text),
    filePath: `/repo/.context/knowledge/${frontmatter.type}/${frontmatter.id}.md`,
  };
}

export function makeConfig(overrides: Record<string, unknown> = {}): ChronicleConfig {
  return ChronicleConfigSchema.parse(overrides);
}

export const LAYERED_SCOPES = {
  backend: ["src/backend/**"],
  "backend.api": ["src/backend/api/**"],
  "backend.api.auth": ["src/backend/api/auth/**"],
  frontend: ["src/app/**"],
  "payments.stripe": ["src/payments/stripe/**"],
};
