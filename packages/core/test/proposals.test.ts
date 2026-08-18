import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readHistory } from "../src/history.js";
import {
  acceptProposal,
  buildChanges,
  listProposals,
  proposalDiff,
  proposeChange,
  proposeCreate,
  rejectProposal,
  renderDiff,
} from "../src/proposals.js";
import { chroniclePaths } from "../src/paths.js";
import type { Actor } from "../src/schema.js";
import { ChronicleStore } from "../src/store.js";

const human: Actor = { kind: "human", id: "reviewer" };
const agent: Actor = { kind: "agent", id: "cursor" };

let root: string;
let store: ChronicleStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "chronicle-proposals-"));
  store = await ChronicleStore.init(root, human);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setAuthority(patch: string): Promise<void> {
  await writeFile(chroniclePaths(root).configFile, `version: 1\nauthority:\n${patch}\n`, "utf8");
  store = await ChronicleStore.openAt(root);
}

describe("proposeCreate", () => {
  it("stages a file under proposals and writes nothing to knowledge", async () => {
    const proposal = await proposeCreate(store, {
      draft: { type: "rule", title: "Use Redis for rate limiting" },
      proposedBy: agent,
      reason: "Detected in conversation",
    });

    expect(proposal.id).toMatch(/^pr_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await listProposals(store.paths)).toHaveLength(1);
    await store.reload();
    expect(store.list()).toHaveLength(0);
  });

  it("attributes agent proposals to the ai source", async () => {
    const proposal = await proposeCreate(store, {
      draft: { type: "convention", title: "Handlers stay thin" },
      proposedBy: agent,
      reason: "Observed in 12 files",
    });
    expect(proposal.payload?.source).toBe("ai");
  });

  it("records the proposal in the history log", async () => {
    await proposeCreate(store, {
      draft: { type: "rule", title: "Use Redis" },
      proposedBy: agent,
      reason: "Detected in conversation",
    });
    const events = await readHistory(store.paths, { op: "propose" });
    expect(events[0]?.summary).toContain('Proposed new rule "Use Redis"');
    expect(events[0]?.actor.kind).toBe("agent");
  });
});

describe("authority levels", () => {
  it("blocks agent proposals entirely when autoLearn is off", async () => {
    await setAuthority("  autoLearn: false");
    await expect(
      proposeCreate(store, {
        draft: { type: "rule", title: "Use Redis" },
        proposedBy: agent,
        reason: "why not",
      }),
    ).rejects.toThrow(/autoLearn disabled/);
  });

  it("still lets a person stage a proposal when autoLearn is off", async () => {
    await setAuthority("  autoLearn: false");
    const proposal = await proposeCreate(store, {
      draft: { type: "rule", title: "Use Redis" },
      proposedBy: human,
      reason: "for review",
    });
    expect(proposal.op).toBe("create");
  });

  it("stops an agent rewriting an accepted rule by default", async () => {
    const rule = await store.create({ type: "rule", title: "Never use Prisma" }, human);
    await expect(
      proposeChange(store, {
        targetRef: rule.id,
        op: "update",
        patch: { title: "Prisma is fine actually" },
        proposedBy: agent,
        reason: "saw it in the code",
      }),
    ).rejects.toThrow(/autoModifyRules disabled/);
  });

  it("lets an agent propose changes to softer knowledge", async () => {
    const convention = await store.create({ type: "convention", title: "Files are kebab-case" }, human);
    const proposal = await proposeChange(store, {
      targetRef: convention.id,
      op: "update",
      patch: { title: "Files are snake_case" },
      proposedBy: agent,
      reason: "23 files disagree",
    });
    expect(proposal.op).toBe("update");
  });

  it("allows rule changes once autoModifyRules is enabled", async () => {
    await setAuthority("  autoModifyRules: true");
    const rule = await store.create({ type: "rule", title: "Never use Prisma" }, human);
    const proposal = await proposeChange(store, {
      targetRef: rule.id,
      op: "update",
      patch: { confidence: 0.5 },
      proposedBy: agent,
      reason: "less certain now",
    });
    expect(proposal.changes?.confidence).toEqual({ before: 0.8, after: 0.5 });
  });
});

describe("buildChanges", () => {
  it("captures before and after per field and skips no-ops", async () => {
    const item = await store.create({ type: "rule", title: "Original", tags: ["a"] }, human);
    const changes = buildChanges(item, { title: "Changed", tags: ["a"], confidence: 0.5 });

    expect(changes.title).toEqual({ before: "Original", after: "Changed" });
    expect(changes.confidence).toEqual({ before: 0.8, after: 0.5 });
    expect(changes.tags).toBeUndefined();
  });

  it("refuses a proposal that would change nothing", async () => {
    const item = await store.create({ type: "convention", title: "Same" }, human);
    await expect(
      proposeChange(store, {
        targetRef: item.id,
        op: "update",
        patch: { title: "Same" },
        proposedBy: agent,
        reason: "no change",
      }),
    ).rejects.toThrow(/would not change anything/);
  });
});

describe("acceptProposal", () => {
  it("moves a create proposal into the knowledge layer and clears the staging file", async () => {
    const proposal = await proposeCreate(store, {
      draft: { type: "rule", title: "Use Redis for rate limiting", scopes: ["backend"] },
      proposedBy: agent,
      reason: "Detected in conversation",
    });

    const { item } = await acceptProposal(store, proposal.id, human);
    expect(item?.title).toBe("Use Redis for rate limiting");
    expect(item?.scopes).toEqual(["backend"]);
    expect(await listProposals(store.paths)).toHaveLength(0);

    const reopened = await ChronicleStore.openAt(root);
    expect(reopened.list()).toHaveLength(1);
  });

  it("applies reviewer edits over the agent's suggestion", async () => {
    const proposal = await proposeCreate(store, {
      draft: { type: "rule", title: "use redis", scopes: ["project"] },
      proposedBy: agent,
      reason: "Detected in conversation",
    });

    const { item } = await acceptProposal(store, proposal.id, human, {
      overrides: { title: "Use Redis for rate limiting", scopes: ["backend.api"] },
    });
    expect(item?.title).toBe("Use Redis for rate limiting");
    expect(item?.scopes).toEqual(["backend.api"]);

    const events = await readHistory(store.paths, { op: "accept" });
    expect(events[0]?.summary).toContain("with edits");
  });

  it("applies an update proposal to the existing item", async () => {
    const convention = await store.create({ type: "convention", title: "Files are kebab-case" }, human);
    const proposal = await proposeChange(store, {
      targetRef: convention.id,
      op: "update",
      patch: { title: "Files are snake_case" },
      proposedBy: agent,
      reason: "23 files disagree",
    });

    const { item } = await acceptProposal(store, proposal.id, human);
    expect(item?.id).toBe(convention.id);
    expect(item?.title).toBe("Files are snake_case");
  });

  it("applies an archive proposal", async () => {
    const convention = await store.create({ type: "convention", title: "Old habit" }, human);
    const proposal = await proposeChange(store, {
      targetRef: convention.id,
      op: "archive",
      proposedBy: agent,
      reason: "no longer true",
    });

    const { item } = await acceptProposal(store, proposal.id, human);
    expect(item?.status).toBe("archived");
  });

  it("never lets an agent accept its own proposal", async () => {
    const proposal = await proposeCreate(store, {
      draft: { type: "rule", title: "Use Redis" },
      proposedBy: agent,
      reason: "Detected in conversation",
    });
    await expect(acceptProposal(store, proposal.id, agent)).rejects.toThrow(/only be accepted by a person/);
    expect(await listProposals(store.paths)).toHaveLength(1);
  });

  it("rejects an edit that would produce an invalid item", async () => {
    const proposal = await proposeCreate(store, {
      draft: { type: "rule", title: "Use Redis" },
      proposedBy: agent,
      reason: "Detected in conversation",
    });
    await expect(
      acceptProposal(store, proposal.id, human, { overrides: { scopes: ["Not A Scope"] } }),
    ).rejects.toThrow(/cannot be accepted as edited/);
  });
});

describe("rejectProposal", () => {
  it("discards the file but keeps the whole proposal in history", async () => {
    const proposal = await proposeCreate(store, {
      draft: { type: "rule", title: "Use Redis" },
      proposedBy: agent,
      reason: "Detected in conversation",
    });

    await rejectProposal(store, proposal.id, human, "We already use a token bucket in the gateway");
    expect(await listProposals(store.paths)).toHaveLength(0);

    const events = await readHistory(store.paths, { op: "reject" });
    expect(events[0]?.summary).toContain("token bucket");
    expect((events[0]?.before as { payload?: { title?: string } })?.payload?.title).toBe("Use Redis");
  });
});

describe("proposalDiff", () => {
  it("shows a creation as additions", async () => {
    const proposal = await proposeCreate(store, {
      draft: {
        type: "rule",
        title: "Use Redis for rate limiting",
        scopes: ["backend"],
        body: "Token buckets live in Redis so they survive a deploy.",
      },
      proposedBy: agent,
      reason: "Detected in conversation",
    });

    const text = renderDiff(proposalDiff(proposal));
    expect(text).toContain("+ new rule: Use Redis for rate limiting");
    expect(text).toContain("scopes: backend");
    expect(text).toContain("+     Token buckets live in Redis");
  });

  it("shows an update as a before and after pair per field", async () => {
    const convention = await store.create({ type: "convention", title: "Files are kebab-case" }, human);
    const proposal = await proposeChange(store, {
      targetRef: convention.id,
      op: "update",
      patch: { title: "Files are snake_case" },
      proposedBy: agent,
      reason: "23 files disagree",
    });

    const text = renderDiff(proposalDiff(proposal, convention));
    expect(text).toContain("~ update convention: Files are kebab-case");
    expect(text).toContain("-     title: Files are kebab-case");
    expect(text).toContain("+     title: Files are snake_case");
  });

  it("shows an archive as a removal", async () => {
    const item = await store.create({ type: "decision", title: "MongoDB for storage" }, human);
    const proposal = await proposeChange(store, {
      targetRef: item.id,
      op: "archive",
      proposedBy: human,
      reason: "we migrated",
    });
    expect(renderDiff(proposalDiff(proposal, item))).toContain("- archive decision: MongoDB for storage");
  });
});

describe("proposal storage", () => {
  it("keeps proposals as readable YAML the developer can inspect", async () => {
    const proposal = await proposeCreate(store, {
      draft: { type: "rule", title: "Use Redis" },
      proposedBy: agent,
      reason: "Detected in conversation",
    });
    const raw = await readFile(path.join(root, ".chronicle/proposals", `${proposal.id}.yaml`), "utf8");
    expect(raw).toContain("op: create");
    expect(raw).toContain("reason: Detected in conversation");
  });

  it("reports a corrupt proposal instead of ignoring it", async () => {
    await writeFile(path.join(root, ".chronicle/proposals/broken.yaml"), "op: nonsense\n", "utf8");
    await expect(listProposals(store.paths)).rejects.toThrow(/not a valid proposal/);
  });
});
