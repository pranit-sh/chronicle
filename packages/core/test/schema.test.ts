import { describe, expect, it } from "vitest";

import {
  ChronicleConfigSchema,
  DEFAULT_CONFIG,
  EvidenceSchema,
  KnowledgeFrontmatterSchema,
  ProposalSchema,
} from "../src/schema.js";

const baseFrontmatter = {
  id: "k_01J8ZQ4M7XABCDEFGHJKMNPQRS",
  type: "rule",
  title: "Never call the DB directly from API handlers",
  createdAt: "2026-08-18T09:00:00.000Z",
  updatedAt: "2026-08-18T09:00:00.000Z",
  actor: { kind: "human", id: "vinay" },
};

describe("ChronicleConfigSchema", () => {
  it("fills nested defaults when given an empty object", () => {
    const config = ChronicleConfigSchema.parse({});
    expect(config.budget.maxItems).toBe(25);
    expect(config.budget.maxChars).toBe(8000);
    expect(config.authority.autoLearn).toBe(true);
    expect(config.authority.autoModifyRules).toBe(false);
    expect(config.resolver.weights.keyword).toBe(2.5);
    expect(config.resolver.freshnessHorizonDays).toBe(90);
    expect(config.exclude).toContain("**/node_modules/**");
  });

  it("exposes a prebuilt default config", () => {
    expect(DEFAULT_CONFIG.version).toBe(1);
    expect(DEFAULT_CONFIG.scopes).toEqual({});
  });

  it("rejects malformed scope ids", () => {
    const result = ChronicleConfigSchema.safeParse({ scopes: { "Backend API": ["src/**"] } });
    expect(result.success).toBe(false);
  });

  it("accepts dotted scope ids", () => {
    const config = ChronicleConfigSchema.parse({ scopes: { "backend.api": ["src/api/**"] } });
    expect(config.scopes["backend.api"]).toEqual(["src/api/**"]);
  });
});

describe("KnowledgeFrontmatterSchema", () => {
  it("applies defaults and discriminates on type", () => {
    const parsed = KnowledgeFrontmatterSchema.parse(baseFrontmatter);
    expect(parsed.type).toBe("rule");
    expect(parsed.status).toBe("active");
    expect(parsed.scopes).toEqual(["project"]);
    expect(parsed.confidence).toBe(0.8);
    expect(parsed.provenance.origin).toBe("manual");
    if (parsed.type === "rule") {
      expect(parsed.enforcement).toBe("must");
    }
  });

  it("defaults context items to a temporary lifetime", () => {
    const parsed = KnowledgeFrontmatterSchema.parse({
      ...baseFrontmatter,
      type: "context",
      expiresAt: "2026-12-01",
    });
    expect(parsed.lifetime).toBe("temporary");
  });

  it("requires expiresAt for expiring lifetimes", () => {
    const result = KnowledgeFrontmatterSchema.safeParse({ ...baseFrontmatter, lifetime: "temporary" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.includes("expiresAt"))).toBe(true);
  });

  it("rejects self supersession", () => {
    const result = KnowledgeFrontmatterSchema.safeParse({
      ...baseFrontmatter,
      supersedes: [baseFrontmatter.id],
    });
    expect(result.success).toBe(false);
  });

  it("normalises Date instances handed back by a YAML parser", () => {
    const parsed = KnowledgeFrontmatterSchema.parse({
      ...baseFrontmatter,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(parsed.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("EvidenceSchema", () => {
  it("defaults grep evidence to the whole tree and expecting presence", () => {
    const parsed = EvidenceSchema.parse({ kind: "grep", pattern: "repository\\." });
    expect(parsed).toMatchObject({ kind: "grep", glob: "**/*", expect: "present" });
  });

  it("keeps absent expectations for contradiction checks", () => {
    const parsed = EvidenceSchema.parse({
      kind: "grep",
      glob: "src/api/**/*.ts",
      pattern: "db\\.",
      expect: "absent",
    });
    expect(parsed.expect).toBe("absent");
  });
});

describe("ProposalSchema", () => {
  const base = {
    id: "pr_01J8ZQ4M7XABCDEFGHJKMNPQRS",
    proposedBy: { kind: "agent", id: "cursor" },
    createdAt: "2026-08-18T09:00:00.000Z",
    reason: "Detected in conversation",
  };

  it("requires a payload for create proposals", () => {
    expect(ProposalSchema.safeParse({ ...base, op: "create" }).success).toBe(false);
    expect(
      ProposalSchema.safeParse({
        ...base,
        op: "create",
        payload: { type: "rule", title: "Use Zod for validation" },
      }).success,
    ).toBe(true);
  });

  it("requires a targetId and changes for update proposals", () => {
    expect(ProposalSchema.safeParse({ ...base, op: "update" }).success).toBe(false);
    expect(
      ProposalSchema.safeParse({
        ...base,
        op: "update",
        targetId: baseFrontmatter.id,
        changes: { title: { before: "old", after: "new" } },
      }).success,
    ).toBe(true);
  });

  it("rejects changes to fields that are not updatable", () => {
    const result = ProposalSchema.safeParse({
      ...base,
      op: "update",
      targetId: baseFrontmatter.id,
      changes: { id: { before: "a", after: "b" } },
    });
    expect(result.success).toBe(false);
  });
});
