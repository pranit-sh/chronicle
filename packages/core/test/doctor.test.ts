import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chronicleSizeBytes, isHealthy, runDoctor } from "../src/doctor.js";
import { appendHistory, groupByDay, readHistory } from "../src/history.js";
import { proposeChange, proposeCreate } from "../src/proposals.js";
import type { Actor } from "../src/schema.js";
import { ChronicleStore } from "../src/store.js";

const actor: Actor = { kind: "human", id: "tester" };
const agent: Actor = { kind: "agent", id: "cursor" };

let root: string;
let store: ChronicleStore;

const codes = (diagnoses: readonly { code: string }[]) => diagnoses.map((d) => d.code);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "chronicle-doctor-"));
  store = await ChronicleStore.init(root, actor);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("doctor", () => {
  it("reports a healthy freshly initialized project", async () => {
    const report = await runDoctor(root);
    expect(report.initialized).toBe(true);
    expect(report.counts.error).toBe(0);
    expect(isHealthy(report)).toBe(true);
  });

  it("says what to do when there is no knowledge layer at all", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "chronicle-bare-"));
    const report = await runDoctor(empty);
    expect(report.initialized).toBe(false);
    expect(report.diagnoses[0]?.fix).toBe("Run chronicle init");
    await rm(empty, { recursive: true, force: true });
  });

  it("tells a pre-0.1.0 checkout to rename .context rather than re-initialize", async () => {
    const legacy = await mkdtemp(path.join(tmpdir(), "chronicle-legacy-"));
    await mkdir(path.join(legacy, ".context", "knowledge"), { recursive: true });

    const report = await runDoctor(legacy);
    expect(report.initialized).toBe(false);
    expect(report.diagnoses[0]?.code).toBe("legacy_directory");
    expect(report.diagnoses[0]?.fix).toBe("Run git mv .context .chronicle");

    await expect(ChronicleStore.open(legacy)).rejects.toThrow(/git mv \.context \.chronicle/);
    await rm(legacy, { recursive: true, force: true });
  });

  it("finds Git conflict markers left in a knowledge file", async () => {
    const item = await store.create({ type: "rule", title: "Use pnpm" }, actor);
    const raw = await readFile(item.filePath, "utf8");
    await writeFile(
      item.filePath,
      `${raw}\n${"<".repeat(7)} HEAD\nours\n${"=".repeat(7)}\ntheirs\n${">".repeat(7)} feature\n`,
      "utf8",
    );

    const report = await runDoctor(root);
    const conflict = report.diagnoses.find((d) => d.code === "conflict_markers");
    expect(conflict?.level).toBe("error");
    expect(conflict?.message).toMatch(/line/);
    expect(isHealthy(report)).toBe(false);
  });

  it("finds conflict markers in config and history too, not just knowledge", async () => {
    await writeFile(
      path.join(root, ".chronicle/history/2026-08-18.jsonl"),
      `${"<".repeat(7)} HEAD\n`,
      "utf8",
    );
    const report = await runDoctor(root);
    expect(codes(report.diagnoses)).toContain("conflict_markers");
    expect(report.diagnoses.find((d) => d.code === "conflict_markers")?.file).toContain("history");
  });

  it("does not report a conflicted file twice as unparseable", async () => {
    const item = await store.create({ type: "rule", title: "Use pnpm" }, actor);
    await writeFile(item.filePath, `${"<".repeat(7)} HEAD\ngarbage\n`, "utf8");
    const report = await runDoctor(root);
    expect(codes(report.diagnoses)).toContain("conflict_markers");
    expect(codes(report.diagnoses)).not.toContain("invalid_item");
  });

  it("explains a knowledge file with broken frontmatter instead of throwing", async () => {
    await writeFile(
      path.join(root, ".chronicle/knowledge/rules/handwritten.md"),
      "---\ntype: rule\n---\n\nNo id, no title.\n",
      "utf8",
    );
    const report = await runDoctor(root);
    const invalid = report.diagnoses.find((d) => d.code === "invalid_item");
    expect(invalid?.level).toBe("error");
    expect(invalid?.file).toContain("handwritten.md");
  });

  it("catches the duplicate ids a bad merge leaves behind", async () => {
    const item = await store.create({ type: "rule", title: "Use pnpm" }, actor);
    const raw = await readFile(item.filePath, "utf8");
    await writeFile(path.join(root, ".chronicle/knowledge/rules/use-pnpm-copy.md"), raw, "utf8");

    const report = await runDoctor(root);
    const duplicate = report.diagnoses.find((d) => d.code === "duplicate_id");
    expect(duplicate?.level).toBe("error");
    expect(duplicate?.message).toContain(item.id);
  });

  it("flags a reference to an item that no longer exists", async () => {
    await store.create(
      { type: "rule", title: "Use pnpm", relatedTo: ["k_01JZZZZZZZZZZZZZZZZZZZZZZZ"] },
      actor,
    );
    const report = await runDoctor(root);
    const dangling = report.diagnoses.find((d) => d.code === "dangling_reference");
    expect(dangling?.level).toBe("warning");
    expect(dangling?.message).toContain("relatedTo");
  });

  it("accepts a reference that does resolve", async () => {
    const first = await store.create({ type: "rule", title: "Use pnpm" }, actor);
    await store.create({ type: "rule", title: "Use pnpm workspaces", supersedes: [first.id] }, actor);
    const report = await runDoctor(root);
    expect(codes(report.diagnoses)).not.toContain("dangling_reference");
  });

  it("notices an item whose status and directory disagree", async () => {
    const item = await store.create({ type: "rule", title: "Use pnpm" }, actor);
    const raw = await readFile(item.filePath, "utf8");
    await writeFile(item.filePath, raw.replace("status: active", "status: archived"), "utf8");

    const report = await runDoctor(root);
    expect(codes(report.diagnoses)).toContain("misplaced_archived");
  });

  it("notices expired knowledge that is still marked active", async () => {
    await store.create(
      {
        type: "context",
        title: "Migrating to Better Auth",
        lifetime: "temporary",
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
      actor,
    );
    const report = await runDoctor(root);
    const expired = report.diagnoses.find((d) => d.code === "expired");
    expect(expired?.fix).toBe("Run chronicle verify");
  });

  it("points out a scope no file path will ever activate", async () => {
    await store.create({ type: "rule", title: "Use pnpm", scopes: ["backend.api"] }, actor);
    const report = await runDoctor(root);
    const unmapped = report.diagnoses.find((d) => d.code === "unmapped_scope");
    expect(unmapped?.level).toBe("info");
    expect(unmapped?.message).toContain("backend.api");
  });

  it("stays quiet about the project scope, which is always active", async () => {
    await store.create({ type: "rule", title: "Use pnpm" }, actor);
    const report = await runDoctor(root);
    expect(codes(report.diagnoses)).not.toContain("unmapped_scope");
  });

  it("counts pending proposals and flags orphaned ones", async () => {
    const item = await store.create({ type: "architecture", title: "Auth lives in src/auth" }, actor);
    await proposeChange(store, {
      op: "update",
      targetRef: item.id,
      patch: { title: "Auth lives in src/identity" },
      proposedBy: agent,
      reason: "The directory was renamed",
    });
    await proposeCreate(store, {
      draft: { type: "rule", title: "Prefer ESM" },
      proposedBy: agent,
      reason: "Every package.json sets type: module",
    });

    const before = await runDoctor(root);
    expect(before.diagnoses.find((d) => d.code === "pending_proposals")?.message).toContain("2 proposals");
    expect(codes(before.diagnoses)).not.toContain("orphan_proposal");

    await store.remove(item.id, actor);
    const after = await runDoctor(root);
    expect(codes(after.diagnoses)).toContain("orphan_proposal");
  });

  it("warns when the derived cache is not gitignored", async () => {
    await rm(path.join(root, ".chronicle/.gitignore"));
    const report = await runDoctor(root);
    expect(codes(report.diagnoses)).toContain("cache_not_ignored");
  });

  it("reports unreadable changelog lines without losing the readable ones", async () => {
    await writeFile(
      path.join(root, ".chronicle/history/2026-08-18.jsonl"),
      '{"not":"json"\nnonsense\n',
      "utf8",
    );
    const report = await runDoctor(root);
    const corrupt = report.diagnoses.find((d) => d.code === "corrupt_history");
    expect(corrupt?.message).toContain("2 unreadable lines");
  });

  it("never reads the derived cache, which is allowed to be anything", async () => {
    await mkdir(path.join(root, ".chronicle/.cache"), { recursive: true });
    await writeFile(path.join(root, ".chronicle/.cache/index.json"), `${"<".repeat(7)} HEAD`, "utf8");
    const report = await runDoctor(root);
    expect(codes(report.diagnoses)).not.toContain("conflict_markers");
  });

  it("measures how much space the knowledge layer takes", async () => {
    await store.create({ type: "rule", title: "Use pnpm" }, actor);
    expect(await chronicleSizeBytes(root)).toBeGreaterThan(0);
  });
});

describe("history", () => {
  it("records the whole life of an item in order", async () => {
    const item = await store.create({ type: "rule", title: "Use pnpm" }, actor);
    await store.update(item.id, { title: "Use pnpm workspaces" }, actor);
    await store.archive(item.id, actor);

    const events = await readHistory(store.paths, { itemId: item.id });
    expect(events.map((event) => event.op)).toEqual(["create", "update", "archive"]);
  });

  it("filters by kind of event", async () => {
    const item = await store.create({ type: "rule", title: "Use pnpm" }, actor);
    await store.update(item.id, { title: "Use pnpm workspaces" }, actor);
    const events = await readHistory(store.paths, { op: "update" });
    expect(events).toHaveLength(1);
  });

  it("filters by time window", async () => {
    await appendHistory(store.paths, {
      op: "create",
      actor,
      summary: "ancient",
      ts: "2020-01-01T00:00:00.000Z",
    });
    await appendHistory(store.paths, { op: "create", actor, summary: "recent" });

    const recent = await readHistory(store.paths, { since: new Date(Date.now() - 3_600_000) });
    expect(recent.map((event) => event.summary)).not.toContain("ancient");
  });

  it("keeps the newest events when a limit is applied", async () => {
    for (let index = 0; index < 5; index += 1) {
      await appendHistory(store.paths, {
        op: "create",
        actor,
        summary: `event ${index}`,
        ts: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      });
    }
    const events = await readHistory(store.paths, { op: "create", limit: 2 });
    expect(events.map((event) => event.summary)).toEqual(["event 3", "event 4"]);
  });

  it("skips a corrupt line rather than failing the whole changelog", async () => {
    await appendHistory(store.paths, { op: "create", actor, summary: "good" });
    const file = path.join(store.paths.historyDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    await writeFile(file, `${await readFile(file, "utf8")}{ broken\n`, "utf8");

    const events = await readHistory(store.paths);
    expect(events.some((event) => event.summary === "good")).toBe(true);
  });

  it("groups events newest day first for the changelog", async () => {
    await appendHistory(store.paths, { op: "create", actor, summary: "a", ts: "2026-08-01T10:00:00.000Z" });
    await appendHistory(store.paths, { op: "create", actor, summary: "b", ts: "2026-08-03T10:00:00.000Z" });
    const grouped = groupByDay(await readHistory(store.paths, { op: "create" }));
    expect(grouped.map(([day]) => day)).toEqual(["2026-08-03", "2026-08-01"]);
  });

  it("attributes agent activity separately from human activity", async () => {
    await proposeCreate(store, {
      draft: { type: "rule", title: "Prefer ESM" },
      proposedBy: agent,
      reason: "Every package.json sets type: module",
    });
    const events = await readHistory(store.paths, { op: "propose" });
    expect(events[0]?.actor).toEqual(agent);
  });
});
