import { describe, expect, it } from "vitest";

import { classifyStatement, defaultExpiry, inferScopes } from "../src/classify.js";

describe("classifyStatement", () => {
  it("reads a prohibition as a rule that must never happen", () => {
    const result = classifyStatement("Never call the database directly from API handlers");
    expect(result.type).toBe("rule");
    expect(result.enforcement).toBe("never");
  });

  it("reads a requirement as a rule that must happen", () => {
    expect(classifyStatement("Always run migrations inside a transaction")).toMatchObject({
      type: "rule",
      enforcement: "must",
    });
    expect(classifyStatement("All API responses must use the envelope format")).toMatchObject({
      type: "rule",
      enforcement: "must",
    });
  });

  it("reads a preference as a rule that should happen", () => {
    expect(classifyStatement("Prefer composition to inheritance")).toMatchObject({
      type: "rule",
      enforcement: "should",
    });
  });

  it("records a settled choice as a decision", () => {
    expect(classifyStatement("We decided to use PostgreSQL over MongoDB").type).toBe("decision");
  });

  it("treats an in-flight situation as temporary context, not a permanent rule", () => {
    const result = classifyStatement("Auth is currently mid-migration to Better Auth");
    expect(result.type).toBe("context");
    expect(result.lifetime).toBe("temporary");
  });

  it("recognises something to watch out for as an issue", () => {
    expect(classifyStatement("Uploads over 10MB occasionally time out").type).toBe("issue");
  });

  it("recognises a business concept as domain knowledge", () => {
    expect(classifyStatement("An organization has exactly one owner").type).toBe("domain");
  });

  it("falls back to a convention rather than inventing a rule", () => {
    const result = classifyStatement("Handlers live next to their tests");
    expect(result.type).toBe("convention");
    expect(result.reason).toContain("no stronger signal");
  });

  it("uses the first sentence as the title and keeps the full text as the body", () => {
    const result = classifyStatement(
      "Never edit generated/openapi. It is regenerated on every build and your changes will be lost.",
    );
    expect(result.title).toBe("Never edit generated/openapi");
    expect(result.body).toContain("regenerated on every build");
  });

  it("leaves the body empty when the statement is a single sentence", () => {
    expect(classifyStatement("Never use Prisma").body).toBe("");
  });

  it("clips an overlong title at a word boundary rather than mid-word", () => {
    const long = `Never ${"deploy on a Friday afternoon ".repeat(8)}without a rollback plan`;
    const { title } = classifyStatement(long);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith("\u2026")).toBe(true);

    // The kept portion is a whole-word prefix of the original statement.
    const stem = title.slice(0, -1);
    expect(long.startsWith(stem)).toBe(true);
    expect(long[stem.length]).toBe(" ");
  });

  it("explains which signal it used", () => {
    expect(classifyStatement("Never use Prisma").reason).toBe("starts with a prohibition");
  });
});

describe("inferScopes", () => {
  const known = ["backend", "backend.api", "frontend", "payments.stripe"];

  it("only suggests scopes the developer already declared", () => {
    expect(inferScopes("Never call the database from a backend api handler", known)).toEqual([
      "backend.api",
    ]);
  });

  it("matches plural mentions of a scope segment", () => {
    expect(inferScopes("All stripe payments are logged", known)).toEqual(["payments.stripe"]);
  });

  it("keeps only the most specific match", () => {
    const scopes = inferScopes("backend api rules", known);
    expect(scopes).toEqual(["backend.api"]);
  });

  it("falls back to the project scope when nothing matches", () => {
    expect(inferScopes("Use tabs, not spaces", known)).toEqual(["project"]);
  });

  it("collapses siblings to the scope they share rather than scattering", () => {
    const scopes = ["core.schema", "core.store", "core.resolver", "mcp"];
    expect(inferScopes("The core schema, core store and core resolver are all typed", scopes)).toEqual([
      "core",
    ]);
  });

  it("falls back to the project scope when the areas have nothing in common", () => {
    const scopes = ["core.schema", "mcp", "cli"];
    expect(inferScopes("The mcp server and the cli both call the core schema", scopes)).toEqual(["project"]);
  });

  it("never invents a scope that is not configured", () => {
    expect(inferScopes("The mobile app uses Expo", known)).toEqual(["project"]);
  });
});

describe("defaultExpiry", () => {
  it("defaults temporary knowledge to 30 days out", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(defaultExpiry(from)).toBe("2026-01-31T00:00:00.000Z");
  });
});
