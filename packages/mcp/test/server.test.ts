import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { type Actor, ChronicleStore, chroniclePaths, listProposals } from "@chronicle/core";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createChronicleServer } from "../src/server.js";

const actor: Actor = { kind: "human", id: "tester" };

let root: string;
let client: Client;

const CONFIG = `version: 1
scopes:
  backend: ["src/backend/**"]
  backend.api: ["src/backend/api/**"]
  frontend: ["src/app/**"]
`;

/** Reads the text out of a tool result without caring about the content envelope. */
function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  return textOf(await client.callTool({ name, arguments: args }));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "chronicle-mcp-"));
  const store = await ChronicleStore.init(root, actor);
  await writeFile(path.join(root, ".chronicle/config.yaml"), CONFIG, "utf8");

  await store.create(
    { type: "rule", title: "Use TypeScript everywhere", scopes: ["project"], enforcement: "must" },
    actor,
  );
  await store.create(
    {
      type: "rule",
      title: "Never call the database directly from API handlers",
      scopes: ["backend.api"],
      enforcement: "never",
      body: "Handlers stay thin. All database access goes through a repository.",
      tags: ["database"],
    },
    actor,
  );
  await store.create(
    {
      type: "decision",
      title: "PostgreSQL over MongoDB",
      scopes: ["backend"],
      body: "## Decision\nWe use PostgreSQL.\n\n## Rationale\nRelational data and real transactions.",
    },
    actor,
  );
  await store.create(
    { type: "rule", title: "Components are function components", scopes: ["frontend"] },
    actor,
  );

  const server = createChronicleServer({ cwd: root, agentId: "test-agent" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe("tool surface", () => {
  it("exposes no way for an agent to accept, edit or delete knowledge", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "context_resolve",
      "knowledge_get",
      "knowledge_propose",
      "knowledge_search",
    ]);
  });

  it("marks every tool but knowledge_propose as read only", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(tool.name !== "knowledge_propose");
    }
  });

  it("tells the agent to resolve context before editing", async () => {
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("context_resolve");
    expect(instructions).toContain("do not reverse a recorded");
  });
});

describe("context_resolve", () => {
  it("returns only the knowledge in scope for the file", async () => {
    const text = await callTool("context_resolve", {
      file: "src/backend/api/users.ts",
      task: "add pagination",
    });

    expect(text).toContain("Never call the database directly from API handlers");
    expect(text).toContain("Use TypeScript everywhere");
    expect(text).toContain("PostgreSQL over MongoDB");
    expect(text).not.toContain("Components are function components");
  });

  it("reports the scope chain it used", async () => {
    const text = await callTool("context_resolve", { file: "src/backend/api/users.ts" });
    expect(text).toContain("Scopes: project > backend > backend.api");
  });

  it("carries the decision rationale so the agent does not reverse it", async () => {
    const text = await callTool("context_resolve", { file: "src/backend/worker.ts" });
    expect(text).toContain("Rationale: Relational data and real transactions.");
  });

  it("honours a tighter budget", async () => {
    const text = await callTool("context_resolve", {
      file: "src/backend/api/users.ts",
      maxItems: 1,
    });
    expect(text).toContain("1 of 4 knowledge items included");
    expect(text).toContain("Context budget reached");
  });

  it("says plainly when nothing applies", async () => {
    const text = await callTool("context_resolve", { file: "docs/readme.md", maxItems: 200 });
    expect(text).toContain("Use TypeScript everywhere");
    expect(text).not.toContain("Never call the database");
  });
});

describe("knowledge_search", () => {
  it("finds items by free text", async () => {
    const text = await callTool("knowledge_search", { query: "database" });
    expect(text).toContain("Never call the database directly from API handlers");
    expect(text).not.toContain("Components are function components");
  });

  it("filters by type", async () => {
    const text = await callTool("knowledge_search", { type: "decision" });
    expect(text).toContain("PostgreSQL over MongoDB");
    expect(text).not.toContain("Use TypeScript everywhere");
  });

  it("filters by scope subtree", async () => {
    const text = await callTool("knowledge_search", { scope: "backend" });
    expect(text).toContain("PostgreSQL over MongoDB");
    expect(text).toContain("Never call the database");
    expect(text).not.toContain("Components are function components");
  });

  it("reports an empty result without pretending", async () => {
    expect(await callTool("knowledge_search", { query: "kubernetes" })).toBe(
      "No knowledge items match that search.",
    );
  });
});

describe("knowledge_get", () => {
  it("returns the full item with provenance and scope", async () => {
    const search = await callTool("knowledge_search", { query: "PostgreSQL" });
    const id = /`(k_[0-9A-HJKMNP-TV-Z]{26})`/.exec(search)?.[1];
    expect(id).toBeDefined();

    const text = await callTool("knowledge_get", { id: id as string });
    expect(text).toContain("# PostgreSQL over MongoDB");
    expect(text).toContain("- type: decision");
    expect(text).toContain("- scopes: backend");
    expect(text).toContain("Relational data and real transactions.");
  });

  it("accepts a filename slug as well as an id", async () => {
    const text = await callTool("knowledge_get", { id: "postgresql-over-mongodb" });
    expect(text).toContain("# PostgreSQL over MongoDB");
  });

  it("returns a tool error for an unknown id", async () => {
    const result = await client.callTool({ name: "knowledge_get", arguments: { id: "k_nope" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No knowledge item matches");
  });
});

describe("resources", () => {
  it("lists every knowledge item as a resource", async () => {
    const { resources } = await client.listResources();
    const names = resources.map((resource) => resource.name);
    expect(names).toContain("PostgreSQL over MongoDB");
    expect(resources[0]?.uri.startsWith("chronicle://knowledge/")).toBe(true);
  });

  it("reads a single item by uri", async () => {
    const { resources } = await client.listResources();
    const target = resources.find((resource) => resource.name === "PostgreSQL over MongoDB");
    const result = await client.readResource({ uri: target?.uri as string });
    const content = result.contents[0];
    expect(content && "text" in content ? content.text : "").toContain("# PostgreSQL over MongoDB");
    expect(content?.mimeType).toBe("text/markdown");
  });
});

describe("knowledge_propose", () => {
  it("stages a proposal instead of writing knowledge", async () => {
    const text = await callTool("knowledge_propose", {
      op: "create",
      type: "decision",
      title: "Use Redis for rate limiting",
      body: "Token buckets live in Redis so they survive a deploy.",
      scopes: ["backend.api"],
      reason: "The developer said so in conversation",
    });

    expect(text).toContain("Staged for review as pr_");
    expect(text).toContain("This is not project knowledge yet");
    expect(text).toContain("+ new decision: Use Redis for rate limiting");

    const proposals = await listProposals(chroniclePaths(root));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.proposedBy).toEqual({ kind: "agent", id: "test-agent" });
    expect(proposals[0]?.payload?.source).toBe("ai");

    // Nothing reached the knowledge layer.
    const store = await ChronicleStore.openAt(root);
    expect(store.list({ query: "Redis" })).toHaveLength(0);
  });

  it("tells the agent to report it as staged, not saved", async () => {
    const text = await callTool("knowledge_propose", {
      op: "create",
      type: "convention",
      title: "Handlers stay thin",
      reason: "Observed across the API layer",
    });
    expect(text).toContain("rather than saying it has been saved");
  });

  it("refuses a create without a type or title", async () => {
    const result = await client.callTool({
      name: "knowledge_propose",
      arguments: { op: "create", reason: "no idea" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("needs both a type and a title");
  });

  it("refuses to rewrite an accepted rule while autoModifyRules is off", async () => {
    const store = await ChronicleStore.openAt(root);
    const rule = store.list({ query: "Never call the database" })[0];
    const result = await client.callTool({
      name: "knowledge_propose",
      arguments: {
        op: "update",
        targetId: rule?.id,
        title: "Calling the database from handlers is fine",
        reason: "I saw one that does",
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("autoModifyRules disabled");
  });

  it("stages an update to softer knowledge", async () => {
    const store = await ChronicleStore.openAt(root);
    const convention = await store.create(
      { type: "convention", title: "Files are kebab-case" },
      actor,
    );
    const text = await callTool("knowledge_propose", {
      op: "update",
      targetId: convention.id,
      title: "Files are snake_case",
      reason: "23 files disagree",
    });
    expect(text).toContain("~ update convention: Files are kebab-case");
    expect(text).toContain("+     title: Files are snake_case");
  });

  it("refuses an update without a target", async () => {
    const result = await client.callTool({
      name: "knowledge_propose",
      arguments: { op: "update", title: "something", reason: "because" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("needs the targetId");
  });
});

describe("the remember prompt", () => {
  it("pre-classifies the statement and insists the developer reviews it", async () => {
    const result = await client.getPrompt({
      name: "remember",
      arguments: { statement: "Never edit generated/openapi, it is regenerated on every build" },
    });
    const text = result.messages.map((message) => message.content).map((c) => ("text" in c ? c.text : "")).join("\n");

    expect(text).toContain("Never edit generated/openapi");
    expect(text).toContain("reads that as a rule");
    expect(text).toContain("knowledge_propose");
    expect(text).toContain("developer reviews the proposal");
  });
});

describe("uninitialized project", () => {
  it("explains itself instead of failing opaquely", async () => {
    const bare = await mkdtemp(path.join(tmpdir(), "chronicle-bare-"));
    const server = createChronicleServer({ cwd: bare });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const bareClient = new Client({ name: "test-agent", version: "1.0.0" });
    await Promise.all([bareClient.connect(clientTransport), server.connect(serverTransport)]);

    const result = await bareClient.callTool({ name: "context_resolve", arguments: { file: "a.ts" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("no knowledge layer in this project yet");

    await bareClient.close();
    await rm(bare, { recursive: true, force: true });
  });
});
