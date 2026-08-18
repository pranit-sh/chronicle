import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readHistory } from "../src/history.js";
import { chroniclePaths } from "../src/paths.js";
import { ChronicleStore, itemSlug } from "../src/store.js";
import type { Actor } from "../src/schema.js";

const actor: Actor = { kind: "human", id: "tester" };

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "chronicle-store-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function initStore(): Promise<ChronicleStore> {
  return ChronicleStore.init(root, actor);
}

describe("ChronicleStore.init", () => {
  it("lays out .context and records an init event", async () => {
    const store = await initStore();
    const paths = chroniclePaths(root);

    expect(await readFile(paths.configFile, "utf8")).toContain("version: 1");
    expect(await readFile(path.join(paths.contextDir, ".gitignore"), "utf8")).toContain(".cache/");
    expect(store.config.budget.maxItems).toBe(25);

    const history = await readHistory(paths);
    expect(history).toHaveLength(1);
    expect(history[0]?.op).toBe("init");
  });

  it("refuses to initialize twice", async () => {
    await initStore();
    await expect(ChronicleStore.init(root, actor)).rejects.toThrow(/already exists/);
  });
});

describe("ChronicleStore.create", () => {
  it("writes a slugged Markdown file with ordered frontmatter", async () => {
    const store = await initStore();
    const item = await store.create(
      {
        type: "rule",
        title: "Never call the DB directly from API handlers",
        body: "Handlers stay thin. All database access goes through a repository.",
        scopes: ["backend.api"],
        tags: ["database"],
      },
      actor,
    );

    expect(item.filePath).toBe(
      path.join(root, ".context/knowledge/rules/never-call-the-db-directly-from-api-handlers.md"),
    );
    const raw = await readFile(item.filePath, "utf8");
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw.indexOf("id:")).toBeLessThan(raw.indexOf("type:"));
    expect(raw).toContain("scopes:\n  - backend.api");
    expect(raw).toContain("Handlers stay thin.");
    // Defaults that carry no information are left out of the file.
    expect(raw).not.toContain("pinned:");
    expect(raw).not.toContain("evidence:");
  });

  it("gives every item a stable ULID backed id", async () => {
    const store = await initStore();
    const item = await store.create({ type: "convention", title: "Use kebab-case filenames" }, actor);
    expect(item.id).toMatch(/^k_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("disambiguates colliding slugs instead of overwriting", async () => {
    const store = await initStore();
    const first = await store.create({ type: "rule", title: "Use Zod" }, actor);
    const second = await store.create({ type: "rule", title: "Use Zod" }, actor);
    expect(itemSlug(first)).toBe("use-zod");
    expect(itemSlug(second)).toBe("use-zod-2");
    expect(first.id).not.toBe(second.id);
  });

  it("extracts decision sections from the body", async () => {
    const store = await initStore();
    const item = await store.create(
      {
        type: "decision",
        title: "PostgreSQL over MongoDB",
        body: [
          "## Decision",
          "We use PostgreSQL.",
          "",
          "## Rationale",
          "Relational data and real transactions.",
          "",
          "## Alternatives",
          "MongoDB, considered and rejected.",
        ].join("\n"),
      },
      actor,
    );
    expect(item.sections.decision).toBe("We use PostgreSQL.");
    expect(item.sections.rationale).toBe("Relational data and real transactions.");
    expect(item.sections.alternatives).toBe("MongoDB, considered and rejected.");
  });

  it("rejects expiring lifetimes without an expiry date", async () => {
    const store = await initStore();
    await expect(
      store.create({ type: "rule", title: "Temporary rule", lifetime: "temporary" }, actor),
    ).rejects.toThrow(/expiresAt/);
  });
});

describe("ChronicleStore reload and cache", () => {
  it("reads items back from disk in a fresh store", async () => {
    const store = await initStore();
    const created = await store.create(
      { type: "domain", title: "An organization has exactly one owner" },
      actor,
    );

    const reopened = await ChronicleStore.openAt(root);
    const item = reopened.get(created.id);
    expect(item?.title).toBe("An organization has exactly one owner");
    expect(item?.type).toBe("domain");
  });

  it("picks up hand edits because the Markdown is authoritative", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Original title" }, actor);
    const raw = await readFile(created.filePath, "utf8");
    await writeFile(created.filePath, raw.replace("Original title", "Hand edited title"), "utf8");

    const reopened = await ChronicleStore.openAt(root);
    expect(reopened.get(created.id)?.title).toBe("Hand edited title");
  });

  it("survives a corrupt index cache", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Cached rule" }, actor);
    await writeFile(chroniclePaths(root).indexCacheFile, "{ not json", "utf8");

    const reopened = await ChronicleStore.openAt(root);
    expect(reopened.get(created.id)?.title).toBe("Cached rule");
  });

  it("reports a duplicate id rather than silently dropping an item", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Original" }, actor);
    const raw = await readFile(created.filePath, "utf8");
    await writeFile(path.join(root, ".context/knowledge/rules/copy.md"), raw, "utf8");

    await expect(ChronicleStore.openAt(root)).rejects.toThrow(/Duplicate knowledge id/);
  });
});

describe("ChronicleStore.update", () => {
  it("renames the file when the title changes but keeps the id", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Old name" }, actor);
    const updated = await store.update(created.id, { title: "New name" }, actor);

    expect(updated.id).toBe(created.id);
    expect(itemSlug(updated)).toBe("new-name");
    await expect(readFile(created.filePath, "utf8")).rejects.toThrow();
  });

  it("keeps the filename stable for edits that are not renames", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Stable name" }, actor);
    const updated = await store.update(created.id, { confidence: 0.5 }, actor);
    expect(updated.filePath).toBe(created.filePath);
    expect(updated.confidence).toBe(0.5);
  });

  it("advances updatedAt and logs before and after", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Logged" }, actor);
    await store.update(created.id, { confidence: 0.4 }, actor);

    const events = await readHistory(chroniclePaths(root), { itemId: created.id });
    const update = events.find((event) => event.op === "update");
    expect(update?.before).toMatchObject({ confidence: 0.8 });
    expect(update?.after).toMatchObject({ confidence: 0.4 });
  });
});

describe("ChronicleStore archive and restore", () => {
  it("moves the file between knowledge and archive", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Retired rule" }, actor);

    const archived = await store.archive(created.id, actor);
    expect(archived.status).toBe("archived");
    expect(archived.filePath).toBe(path.join(root, ".context/archive/rules/retired-rule.md"));

    const restored = await store.restore(created.id, actor);
    expect(restored.status).toBe("active");
    expect(restored.filePath).toBe(path.join(root, ".context/knowledge/rules/retired-rule.md"));
  });

  it("hides archived items from listings unless asked for", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Retired rule" }, actor);
    await store.archive(created.id, actor);

    expect(store.list()).toHaveLength(0);
    expect(store.list({ includeArchived: true })).toHaveLength(1);
    expect(store.stats().archived).toBe(1);
  });
});

describe("ChronicleStore.resolveRef", () => {
  it("accepts a full id, an id prefix and a slug", async () => {
    const store = await initStore();
    const created = await store.create({ type: "rule", title: "Referenced rule" }, actor);

    expect(store.resolveRef(created.id).id).toBe(created.id);
    expect(store.resolveRef(created.id.slice(0, 10)).id).toBe(created.id);
    expect(store.resolveRef("referenced-rule").id).toBe(created.id);
  });

  it("reports a missing reference clearly", async () => {
    const store = await initStore();
    expect(() => store.resolveRef("nope")).toThrow(/No knowledge item matches/);
  });
});

describe("ChronicleStore.list", () => {
  it("filters by type, scope subtree, tag and free text", async () => {
    const store = await initStore();
    await store.create({ type: "rule", title: "API rule", scopes: ["backend.api"], tags: ["http"] }, actor);
    await store.create({ type: "rule", title: "Frontend rule", scopes: ["frontend"] }, actor);
    await store.create({ type: "decision", title: "Use Postgres", scopes: ["backend"] }, actor);

    expect(store.list({ types: ["rule"] })).toHaveLength(2);
    expect(store.list({ scope: "backend" }).map((item) => item.title).sort()).toEqual([
      "API rule",
      "Use Postgres",
    ]);
    expect(store.list({ tags: ["http"] })).toHaveLength(1);
    expect(store.list({ query: "postgres" })).toHaveLength(1);
  });
});
