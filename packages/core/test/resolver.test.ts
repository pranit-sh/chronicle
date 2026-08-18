import { describe, expect, it } from "vitest";

import { renderContextPackage, resolveContext } from "../src/resolver.js";
import type { KnowledgeItem } from "../src/schema.js";
import { LAYERED_SCOPES, makeConfig, makeItem } from "./fixtures.js";

const config = makeConfig({ scopes: LAYERED_SCOPES });
const root = "/repo";

function resolve(items: KnowledgeItem[], request: Parameters<typeof resolveContext>[1] = {}) {
  return resolveContext({ items, config, root }, request);
}

const titlesOf = (items: KnowledgeItem[], request: Parameters<typeof resolveContext>[1] = {}) =>
  resolve(items, request).entries.map((entry) => entry.item.title);

describe("scope inheritance", () => {
  const items = [
    makeItem({ title: "Use TypeScript everywhere", scopes: ["project"] }),
    makeItem({ title: "Backend errors use AppError", scopes: ["backend"] }),
    makeItem({ title: "API validation uses Zod", scopes: ["backend.api"] }),
    makeItem({ title: "Auth tokens rotate hourly", scopes: ["backend.api.auth"] }),
    makeItem({ title: "Components are function components", scopes: ["frontend"] }),
    makeItem({ title: "Never auto-retry Stripe webhooks", scopes: ["payments.stripe"] }),
  ];

  it("pulls the whole ancestor chain and nothing unrelated", () => {
    const titles = titlesOf(items, { file: "src/backend/api/auth/login.ts" });
    expect(titles).toContain("Use TypeScript everywhere");
    expect(titles).toContain("Backend errors use AppError");
    expect(titles).toContain("API validation uses Zod");
    expect(titles).toContain("Auth tokens rotate hourly");
    expect(titles).not.toContain("Components are function components");
    expect(titles).not.toContain("Never auto-retry Stripe webhooks");
  });

  it("ranks the most specific scope first", () => {
    expect(titlesOf(items, { file: "src/backend/api/auth/login.ts" })).toEqual([
      "Auth tokens rotate hourly",
      "API validation uses Zod",
      "Backend errors use AppError",
      "Use TypeScript everywhere",
    ]);
  });

  it("leaves out knowledge that is narrower than the current location", () => {
    const titles = titlesOf(items, { file: "src/backend/worker.ts" });
    expect(titles).toEqual(["Backend errors use AppError", "Use TypeScript everywhere"]);
  });

  it("supplies only project wide knowledge when no file is given", () => {
    expect(titlesOf(items)).toEqual(["Use TypeScript everywhere"]);
  });

  it("records the active scopes and focus scope in the trace", () => {
    const { trace } = resolve(items, { file: "src/backend/api/users.ts" });
    expect(trace.activeScopes).toEqual(["project", "backend", "backend.api"]);
    expect(trace.focusScope).toBe("backend.api");
    expect(trace.consideredCount).toBe(items.length);
  });
});

describe("path targeting", () => {
  it("includes an item whose own globs match, regardless of scope depth", () => {
    const items = [
      makeItem({ title: "Never edit generated OpenAPI clients", scopes: ["frontend"], paths: ["generated/**"] }),
    ];
    expect(titlesOf(items, { file: "generated/openapi/client.ts" })).toEqual([
      "Never edit generated OpenAPI clients",
    ]);
    expect(titlesOf(items, { file: "src/backend/api/users.ts" })).toEqual([]);
  });

  it("explains a path match in the entry reasons", () => {
    const items = [makeItem({ title: "Generated code is off limits", paths: ["generated/**"] })];
    const [entry] = resolve(items, { file: "generated/openapi/client.ts" }).entries;
    expect(entry?.reasons.some((reason) => reason.includes("path glob matches"))).toBe(true);
  });
});

describe("task relevance", () => {
  const items = [
    makeItem({ title: "Use Zustand for component state", scopes: ["frontend"] }),
    makeItem({ title: "Backend errors use AppError", scopes: ["backend"] }),
  ];

  it("pulls in out-of-scope knowledge the task clearly refers to", () => {
    const titles = titlesOf(items, { file: "src/backend/worker.ts", task: "zustand state" });
    expect(titles).toContain("Use Zustand for component state");
  });

  it("leaves that knowledge out when the task does not mention it", () => {
    const titles = titlesOf(items, { file: "src/backend/worker.ts", task: "retry failed jobs" });
    expect(titles).not.toContain("Use Zustand for component state");
  });

  it("names the matching words so the developer can see why", () => {
    const { entries } = resolve(items, { file: "src/backend/worker.ts", task: "zustand state" });
    const entry = entries.find((candidate) => candidate.item.title.includes("Zustand"));
    expect(entry?.reasons.join(" ")).toContain("task mentions");
  });
});

describe("budget packing", () => {
  const many = Array.from({ length: 10 }, (_, index) =>
    makeItem({ title: `Rule number ${index}`, scopes: ["project"], priority: index * 10 }),
  );

  it("stops at maxItems and records why the rest were left out", () => {
    const pkg = resolve(many, { budget: { maxItems: 3 } });
    expect(pkg.entries).toHaveLength(3);
    expect(pkg.stats.itemCount).toBe(3);
    const budgetDrops = pkg.trace.dropped.filter((entry) => entry.reason === "outside the context budget");
    expect(budgetDrops).toHaveLength(7);
    expect(pkg.trace.warnings.join(" ")).toContain("Context budget reached");
  });

  it("keeps the highest scoring knowledge when it has to choose", () => {
    const titles = titlesOf(many, { budget: { maxItems: 2 } });
    expect(titles).toEqual(["Rule number 9", "Rule number 8"]);
  });

  it("stops at maxChars as well as maxItems", () => {
    const pkg = resolve(many, { budget: { maxChars: 120 } });
    expect(pkg.stats.totalChars).toBeLessThanOrEqual(120);
    expect(pkg.entries.length).toBeLessThan(many.length);
  });

  it("always includes pinned knowledge, even past the budget", () => {
    const pinned = makeItem({ title: "Pinned invariant", scopes: ["project"], pinned: true, priority: 0 });
    const pkg = resolve([...many, pinned], { budget: { maxItems: 2 } });
    expect(pkg.entries.map((entry) => entry.item.title)).toContain("Pinned invariant");
    expect(pkg.entries[0]?.item.title).toBe("Pinned invariant");
  });

  it("does not let pinning escape the scope model", () => {
    const pinned = makeItem({ title: "Pinned frontend rule", scopes: ["frontend"], pinned: true });
    expect(titlesOf([pinned], { file: "src/backend/api/users.ts" })).toEqual([]);
    expect(titlesOf([pinned], { file: "src/app/page.tsx" })).toEqual(["Pinned frontend rule"]);
  });
});

describe("lifecycle filtering", () => {
  it("never supplies archived knowledge", () => {
    const items = [makeItem({ title: "Retired rule", status: "archived" })];
    expect(titlesOf(items)).toEqual([]);
  });

  it("hides proposed knowledge unless it is asked for", () => {
    const items = [makeItem({ title: "Suggested rule", status: "proposed", source: "ai" })];
    expect(titlesOf(items)).toEqual([]);
    expect(titlesOf(items, { includeProposed: true })).toEqual(["Suggested rule"]);
  });

  it("includes stale knowledge with a warning but ranks it down", () => {
    const items = [
      makeItem({ title: "Stale rule", status: "stale", priority: 100 }),
      makeItem({ title: "Healthy rule", priority: 50 }),
    ];
    const pkg = resolve(items);
    expect(pkg.entries.map((entry) => entry.item.title)).toEqual(["Healthy rule", "Stale rule"]);
    expect(pkg.trace.warnings.join(" ")).toContain("Stale rule");
  });

  it("drops stale knowledge entirely when includeStale is off", () => {
    const items = [makeItem({ title: "Stale rule", status: "stale" })];
    const pkg = resolve(items, { includeStale: false });
    expect(pkg.entries).toEqual([]);
    expect(pkg.trace.dropped[0]?.reason).toContain("stale");
  });

  it("drops knowledge whose expiry has passed", () => {
    const items = [
      makeItem({
        title: "Migration in progress",
        type: "context",
        lifetime: "temporary",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    ];
    const pkg = resolve(items);
    expect(pkg.entries).toEqual([]);
    expect(pkg.trace.dropped[0]?.reason).toContain("expired on 2020-01-01");
  });
});

describe("supersession", () => {
  it("drops the replaced item and says what replaced it", () => {
    const old = makeItem({ title: "Auth uses JWT" });
    const replacement = makeItem({ title: "Auth uses Better Auth", supersedes: [old.id] });
    const pkg = resolve([old, replacement]);

    expect(pkg.entries.map((entry) => entry.item.title)).toEqual(["Auth uses Better Auth"]);
    expect(pkg.trace.dropped[0]?.reason).toBe('superseded by "Auth uses Better Auth"');
  });

  it("keeps the older item when its replacement is out of scope here", () => {
    const old = makeItem({ title: "Auth uses JWT", scopes: ["project"] });
    const replacement = makeItem({ title: "Auth uses Better Auth", scopes: ["frontend"], supersedes: [old.id] });
    const titles = titlesOf([old, replacement], { file: "src/backend/worker.ts" });
    expect(titles).toEqual(["Auth uses JWT"]);
  });
});

describe("contradiction warnings", () => {
  it("flags an item whose evidence last failed", () => {
    const items = [
      makeItem({
        title: "Auth uses JWT",
        evidence: [{ kind: "grep", pattern: "jsonwebtoken", lastResult: "fail" }],
      }),
    ];
    expect(resolve(items).trace.warnings.join(" ")).toContain("contradicts the repository");
  });
});

describe("renderContextPackage", () => {
  const items = [
    makeItem({ title: "Never call the DB from handlers", enforcement: "never", scopes: ["backend"] }),
    makeItem({
      type: "decision",
      title: "PostgreSQL over MongoDB",
      scopes: ["backend"],
      body: "## Decision\nWe use PostgreSQL.\n\n## Rationale\nRelational data and transactions.",
    }),
    makeItem({ type: "convention", title: "Files are kebab-case", scopes: ["backend"] }),
  ];

  it("groups by type with constraints before background", () => {
    const markdown = renderContextPackage(resolve(items, { file: "src/backend/worker.ts" }));
    expect(markdown.indexOf("## Rules")).toBeLessThan(markdown.indexOf("## Decisions"));
    expect(markdown.indexOf("## Decisions")).toBeLessThan(markdown.indexOf("## Conventions"));
  });

  it("shows enforcement, scope and the decision rationale", () => {
    const markdown = renderContextPackage(resolve(items, { file: "src/backend/worker.ts" }));
    expect(markdown).toContain("**[never] Never call the DB from handlers** `backend`");
    expect(markdown).toContain("We use PostgreSQL.");
    expect(markdown).toContain("Rationale: Relational data and transactions.");
  });

  it("states the scope chain and how much was included", () => {
    const markdown = renderContextPackage(resolve(items, { file: "src/backend/api/users.ts", task: "add paging" }));
    expect(markdown).toContain("Scopes: project > backend > backend.api");
    expect(markdown).toContain("Task: add paging");
    expect(markdown).toContain("of 3 knowledge items included");
  });

  it("says so plainly when nothing applies", () => {
    expect(renderContextPackage(resolve([], { file: "src/x.ts" }))).toContain(
      "No project knowledge applies here yet.",
    );
  });

  it("can append the audit trail of what was left out", () => {
    const pkg = resolve(items, { file: "src/backend/worker.ts", budget: { maxItems: 1 } });
    const markdown = renderContextPackage(pkg, { includeTrace: true });
    expect(markdown).toContain("Left out:");
    expect(markdown).toContain("outside the context budget");
  });
});
