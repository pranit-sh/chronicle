import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkEvidence, createEvidenceContext } from "../src/evidence.js";
import { readHistory } from "../src/history.js";
import { EvidenceSchema, type Actor, type Evidence } from "../src/schema.js";
import { ChronicleStore } from "../src/store.js";
import { verify } from "../src/verifier.js";

const actor: Actor = { kind: "human", id: "tester" };

let root: string;
let store: ChronicleStore;

async function write(relative: string, contents: string): Promise<void> {
  const full = path.join(root, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, contents, "utf8");
}

const evidence = (input: Record<string, unknown>): Evidence => EvidenceSchema.parse(input);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "chronicle-verify-"));
  store = await ChronicleStore.init(root, actor);
  await write("src/api/users.ts", "import { repo } from '../lib/repository';\nexport const list = () => repo.users();\n");
  await write("src/api/orders.ts", "import { repo } from '../lib/repository';\n");
  await write("src/lib/repository.ts", "export const repo = {};\n");
  await write("node_modules/junk/index.js", "db.query('should be ignored')\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("evidence predicates", () => {
  it("checks file existence", async () => {
    const context = await createEvidenceContext(root, store.config);
    expect((await checkEvidence(evidence({ kind: "file", path: "src/lib/repository.ts" }), context)).result).toBe("pass");
    expect((await checkEvidence(evidence({ kind: "file", path: "src/lib/nope.ts" }), context)).result).toBe("fail");
  });

  it("checks that a file is absent", async () => {
    const context = await createEvidenceContext(root, store.config);
    const check = await checkEvidence(
      evidence({ kind: "file", path: "src/lib/prisma.ts", expect: "absent" }),
      context,
    );
    expect(check.result).toBe("pass");
    expect(check.detail).toContain("still absent");
  });

  it("counts glob matches and honours bounds", async () => {
    const context = await createEvidenceContext(root, store.config);
    expect((await checkEvidence(evidence({ kind: "glob", glob: "src/api/**/*.ts" }), context)).matches).toBe(2);
    const bounded = await checkEvidence(
      evidence({ kind: "glob", glob: "src/api/**/*.ts", maxMatches: 1 }),
      context,
    );
    expect(bounded.result).toBe("fail");
    expect(bounded.detail).toContain("expected at most 1");
  });

  it("greps within a glob and names the offending files", async () => {
    await write("src/api/legacy.ts", "const rows = await db.query('select 1')\n");
    const context = await createEvidenceContext(root, store.config);
    const check = await checkEvidence(
      evidence({ kind: "grep", glob: "src/api/**/*.ts", pattern: "db\\.", expect: "absent" }),
      context,
    );
    expect(check.result).toBe("fail");
    expect(check.detail).toContain("src/api/legacy.ts");
  });

  it("never reads excluded paths", async () => {
    const context = await createEvidenceContext(root, store.config);
    expect(context.files.some((file) => file.startsWith("node_modules/"))).toBe(false);
    const check = await checkEvidence(
      evidence({ kind: "grep", glob: "**/*.js", pattern: "db\\.", expect: "absent" }),
      context,
    );
    expect(check.result).toBe("pass");
  });

  it("says so when a grep glob matches no files at all", async () => {
    const context = await createEvidenceContext(root, store.config);
    const check = await checkEvidence(
      evidence({ kind: "grep", glob: "src/graphql/**/*.ts", pattern: "Query" }),
      context,
    );
    expect(check.result).toBe("fail");
    expect(check.detail).toContain("no files matched the glob at all");
  });

  it("reports an invalid regular expression as an error, not a failure", async () => {
    const context = await createEvidenceContext(root, store.config);
    const check = await checkEvidence(evidence({ kind: "grep", pattern: "([unclosed" }), context);
    expect(check.result).toBe("error");
    expect(check.detail).toContain("invalid regular expression");
  });

  it("skips references that cannot be checked automatically", async () => {
    const context = await createEvidenceContext(root, store.config);
    const check = await checkEvidence(
      evidence({ kind: "ref", url: "https://example.com/adr-7", label: "ADR 7" }),
      context,
    );
    expect(check.result).toBe("skipped");
  });
});

describe("verify", () => {
  it("marks an item verified and records when it was checked", async () => {
    const item = await store.create(
      {
        type: "architecture",
        title: "Data access goes through a repository",
        evidence: [evidence({ kind: "file", path: "src/lib/repository.ts" })],
      },
      actor,
    );

    const report = await verify(store, actor);
    expect(report.counts.verified).toBe(1);

    const reopened = await ChronicleStore.openAt(root);
    const after = reopened.get(item.id);
    expect(after?.status).toBe("active");
    expect(after?.lastVerifiedAt).toBeTruthy();
    expect(after?.evidence[0]?.lastResult).toBe("pass");
  });

  it("marks an item stale when the evidence behind it has gone", async () => {
    const item = await store.create(
      {
        type: "architecture",
        title: "Auth lives in src/auth/jwt.ts",
        evidence: [evidence({ kind: "file", path: "src/auth/jwt.ts" })],
      },
      actor,
    );

    const report = await verify(store, actor);
    expect(report.counts.stale).toBe(1);
    expect(report.results[0]?.summary).toContain("The evidence behind this has gone");

    const reopened = await ChronicleStore.openAt(root);
    expect(reopened.get(item.id)?.status).toBe("stale");
    expect(reopened.get(item.id)?.evidence[0]?.lastResult).toBe("fail");
  });

  it("treats an inverted predicate on a fact as the repository contradicting it", async () => {
    await write("src/auth/better-auth.ts", "export const auth = {}\n");
    const item = await store.create(
      {
        type: "architecture",
        title: "Auth uses JWT and nothing else",
        evidence: [evidence({ kind: "glob", glob: "src/auth/better-auth.ts", expect: "absent" })],
      },
      actor,
    );

    const report = await verify(store, actor);
    expect(report.counts.contradicted).toBe(1);
    expect(report.results[0]?.summary).toContain("The repository disagrees");

    // A fact the repository disagrees with is stale knowledge.
    expect((await ChronicleStore.openAt(root)).get(item.id)?.status).toBe("stale");
  });

  it("treats the same signal on a rule as the code breaking the rule, not stale knowledge", async () => {
    await write("src/api/legacy.ts", "const rows = await db.query('select 1')\n");
    const rule = await store.create(
      {
        type: "rule",
        title: "Never call the database directly from API handlers",
        enforcement: "never",
        evidence: [
          evidence({ kind: "grep", glob: "src/api/**/*.ts", pattern: "db\\.", expect: "absent" }),
        ],
      },
      actor,
    );

    const report = await verify(store, actor);
    expect(report.counts.violated).toBe(1);
    expect(report.results[0]?.summary).toContain("The code breaks this rule");

    // The rule still stands; it is the code that is wrong.
    const reopened = await ChronicleStore.openAt(root);
    expect(reopened.get(rule.id)?.status).toBe("active");
  });

  it("brings a stale item back to active once its evidence holds again", async () => {
    const item = await store.create(
      {
        type: "architecture",
        title: "Auth lives in src/auth/jwt.ts",
        status: "stale",
        evidence: [evidence({ kind: "file", path: "src/auth/jwt.ts" })],
      },
      actor,
    );

    await write("src/auth/jwt.ts", "export const sign = () => {}\n");
    const report = await verify(store, actor);
    expect(report.counts.verified).toBe(1);
    expect((await ChronicleStore.openAt(root)).get(item.id)?.status).toBe("active");
  });

  it("marks expired temporary knowledge without needing any evidence", async () => {
    const item = await store.create(
      {
        type: "context",
        title: "Mid-migration to Better Auth",
        lifetime: "temporary",
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
      actor,
    );

    const report = await verify(store, actor);
    expect(report.counts.expired).toBe(1);
    expect((await ChronicleStore.openAt(root)).get(item.id)?.status).toBe("stale");
  });

  it("leaves items alone in a dry run", async () => {
    const item = await store.create(
      {
        type: "architecture",
        title: "Auth lives in src/auth/jwt.ts",
        evidence: [evidence({ kind: "file", path: "src/auth/jwt.ts" })],
      },
      actor,
    );

    const report = await verify(store, actor, { dryRun: true });
    expect(report.counts.stale).toBe(1);
    expect(report.results[0]?.statusChanged).toBe(false);
    expect((await ChronicleStore.openAt(root)).get(item.id)?.status).toBe("active");
  });

  it("ignores items with no machine checkable evidence unless asked", async () => {
    await store.create({ type: "convention", title: "Files are kebab-case" }, actor);
    expect((await verify(store, actor)).results).toHaveLength(0);
    expect((await verify(store, actor, { includeUnverifiable: true })).counts.unverifiable).toBe(1);
  });

  it("can verify a single item by reference", async () => {
    await store.create(
      {
        type: "architecture",
        title: "Repository exists",
        evidence: [evidence({ kind: "file", path: "src/lib/repository.ts" })],
      },
      actor,
    );
    const other = await store.create(
      {
        type: "architecture",
        title: "Auth lives in src/auth/jwt.ts",
        evidence: [evidence({ kind: "file", path: "src/auth/jwt.ts" })],
      },
      actor,
    );

    const report = await verify(store, actor, { references: [other.id] });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.outcome).toBe("stale");
  });

  it("logs a status change to the history so the developer can see it happen", async () => {
    await store.create(
      {
        type: "architecture",
        title: "Auth lives in src/auth/jwt.ts",
        evidence: [evidence({ kind: "file", path: "src/auth/jwt.ts" })],
      },
      actor,
    );

    await verify(store, actor);
    const events = await readHistory(store.paths, { op: "stale" });
    expect(events[0]?.summary).toContain("The evidence behind this has gone");
    expect(events[0]?.after).toMatchObject({ status: "stale" });
  });

  it("does not touch the knowledge text, only its status and evidence results", async () => {
    const item = await store.create(
      {
        type: "architecture",
        title: "Auth lives in src/auth/jwt.ts",
        body: "The signing key comes from the environment.",
        evidence: [evidence({ kind: "file", path: "src/auth/jwt.ts" })],
      },
      actor,
    );

    await verify(store, actor);
    const after = (await ChronicleStore.openAt(root)).get(item.id);
    expect(after?.title).toBe("Auth lives in src/auth/jwt.ts");
    expect(after?.body).toBe("The signing key comes from the environment.");
  });
});
