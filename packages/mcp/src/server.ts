import {
  ISSUE_SEVERITIES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  RULE_ENFORCEMENTS,
  ChronicleError,
  ChronicleStore,
  type KnowledgeStatusName,
  type KnowledgeTypeName,
  classifyStatement,
  proposalDiff,
  proposeChange,
  proposeCreate,
  renderContextPackage,
  renderDiff,
  resolveContextForStore,
} from "@chronicle/core";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { errorResult, formatItem, formatSearchHit, textResult } from "./format.js";

export interface ChronicleServerOptions {
  /** Directory to search upwards from for `.context/`. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Recorded as the author of anything this agent stages. */
  agentId?: string;
  version?: string;
}

const KNOWLEDGE_URI_PREFIX = "chronicle://knowledge/";

/**
 * Re-opens the store on every call. Knowledge is plain Markdown that the
 * developer, Git and the CLI all write to, so the server must never trust a
 * snapshot it took at startup. The mtime keyed cache makes this cheap.
 */
async function openStore(cwd: string): Promise<ChronicleStore> {
  return ChronicleStore.open(cwd);
}

function stagedMessage(proposalId: string, diff: string): string {
  return [
    `Staged for review as ${proposalId}. This is not project knowledge yet.`,
    "",
    diff,
    "",
    `The developer can review it with \`chronicle diff ${proposalId}\` and accept, edit or reject it.`,
    "Tell them it is waiting rather than saying it has been saved.",
  ].join("\n");
}

function describeError(error: unknown): string {
  if (error instanceof ChronicleError) {
    if (error.code === "not_initialized") {
      return `${error.message} Chronicle has no knowledge layer in this project yet, so there is no project context to supply.`;
    }
    return error.message;
  }
  return (error as Error).message ?? String(error);
}

export function createChronicleServer(options: ChronicleServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();
  const server = new McpServer(
    { name: "chronicle", version: options.version ?? "0.1.0" },
    {
      instructions: [
        "Chronicle is this project's knowledge layer: its rules, decisions, architecture, domain",
        "concepts, conventions, current situation and known issues, scoped to the parts of the",
        "codebase they apply to.",
        "",
        "Call context_resolve before writing or changing code, passing the file you are about to",
        "touch and a short description of the task. It returns only the knowledge relevant to that",
        "spot, which is far more reliable than guessing conventions from the surrounding code.",
        "",
        "Treat rules as binding constraints and decisions as settled: do not reverse a recorded",
        "decision without raising it with the developer. Anything marked stale is unverified.",
      ].join("\n"),
    },
  );

  server.registerTool(
    "context_resolve",
    {
      title: "Resolve project context",
      description:
        "Return the project knowledge that applies to a specific file and task: the rules, decisions, architecture, domain concepts, conventions, current context and known issues in scope. Call this before editing code.",
      inputSchema: z.object({
        file: z
          .string()
          .optional()
          .describe("Path of the file being worked on, absolute or relative to the repository root"),
        task: z
          .string()
          .optional()
          .describe("What you have been asked to do, in a sentence. Used to surface relevant knowledge"),
        directory: z.string().optional().describe("Directory being worked in, if there is no single file"),
        openFiles: z.array(z.string()).optional().describe("Other files currently open, for extra scope signal"),
        branch: z.string().optional().describe("Current Git branch"),
        maxItems: z.number().int().positive().max(200).optional().describe("Override the configured item budget"),
        maxChars: z.number().int().positive().optional().describe("Override the configured character budget"),
        includeStale: z
          .boolean()
          .optional()
          .describe("Include knowledge whose evidence no longer holds. Defaults to the project config"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const store = await openStore(cwd);
        const pkg = resolveContextForStore(store, {
          ...(input.file ? { file: input.file } : {}),
          ...(input.task ? { task: input.task } : {}),
          ...(input.directory ? { directory: input.directory } : {}),
          ...(input.openFiles ? { openFiles: input.openFiles } : {}),
          ...(input.branch ? { branch: input.branch } : {}),
          ...(input.includeStale !== undefined ? { includeStale: input.includeStale } : {}),
          ...(input.maxItems !== undefined || input.maxChars !== undefined
            ? {
                budget: {
                  ...(input.maxItems !== undefined ? { maxItems: input.maxItems } : {}),
                  ...(input.maxChars !== undefined ? { maxChars: input.maxChars } : {}),
                },
              }
            : {}),
        });
        return textResult(renderContextPackage(pkg));
      } catch (error) {
        return errorResult(describeError(error));
      }
    },
  );

  server.registerTool(
    "knowledge_search",
    {
      title: "Search project knowledge",
      description:
        "Search the project's knowledge layer by free text, type, scope or status. Use this when you need to check whether something has already been decided, rather than to gather context for an edit.",
      inputSchema: z.object({
        query: z.string().optional().describe("Free text matched against titles, bodies and tags"),
        type: z.enum(KNOWLEDGE_TYPES).optional().describe("Restrict to one kind of knowledge"),
        scope: z.string().optional().describe("Scope such as backend.api; matches that scope and everything under it"),
        status: z.enum(KNOWLEDGE_STATUSES).optional().describe("Restrict to one lifecycle status"),
        limit: z.number().int().positive().max(100).optional().describe("Maximum hits to return, default 20"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const store = await openStore(cwd);
        const items = store.list({
          ...(input.query ? { query: input.query } : {}),
          ...(input.type ? { types: [input.type as KnowledgeTypeName] } : {}),
          ...(input.scope ? { scope: input.scope } : {}),
          ...(input.status ? { statuses: [input.status as KnowledgeStatusName] } : {}),
        });
        if (items.length === 0) return textResult("No knowledge items match that search.");

        const limit = input.limit ?? 20;
        const shown = items.slice(0, limit);
        const lines = shown.map(formatSearchHit);
        if (items.length > shown.length) {
          lines.push("", `${items.length - shown.length} more match; narrow the search or raise the limit.`);
        }
        lines.push("", "Call knowledge_get with an id for the full item, including its rationale and evidence.");
        return textResult(lines.join("\n"));
      } catch (error) {
        return errorResult(describeError(error));
      }
    },
  );

  server.registerTool(
    "knowledge_get",
    {
      title: "Get one knowledge item",
      description:
        "Fetch a single knowledge item in full: its statement, rationale, scope, provenance, confidence and supporting evidence.",
      inputSchema: z.object({
        id: z.string().describe("The item id, or an unambiguous prefix of it, or its filename slug"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        const store = await openStore(cwd);
        return textResult(formatItem(store.resolveRef(id)));
      } catch (error) {
        return errorResult(describeError(error));
      }
    },
  );

  const agent = { kind: "agent", id: options.agentId ?? "agent" } as const;

  server.registerTool(
    "knowledge_propose",
    {
      title: "Propose a change to project knowledge",
      description: [
        "Stage a change to the project's knowledge layer for the developer to review. This never",
        "writes to the knowledge layer directly: it creates a proposal the developer accepts,",
        "edits or rejects.",
        "",
        "Propose only settled things. An explicit statement (\"we've decided to use Redis for rate",
        "limiting\", \"never edit generated/openapi\") is worth recording. A tentative remark",
        "(\"maybe we should try Redis\"), a one-off preference, or something already obvious from",
        "the code is not. When in doubt, do not propose.",
      ].join("\n"),
      inputSchema: z.object({
        op: z
          .enum(["create", "update", "archive"])
          .default("create")
          .describe("Whether to add new knowledge, change existing knowledge, or retire it"),
        reason: z
          .string()
          .describe("Why this is worth recording, and where it came from. The developer sees this first"),
        type: z.enum(KNOWLEDGE_TYPES).optional().describe("Required for create. The kind of knowledge this is"),
        title: z.string().optional().describe("A short statement of the knowledge, one line"),
        body: z.string().optional().describe("The detail. For a decision use ## Decision, ## Rationale, ## Alternatives"),
        scopes: z
          .array(z.string())
          .optional()
          .describe("Dotted scopes this applies to, such as backend.api. Use scopes that already exist in the project"),
        paths: z.array(z.string()).optional().describe("Path globs this applies to, such as src/api/**"),
        tags: z.array(z.string()).optional(),
        enforcement: z.enum(RULE_ENFORCEMENTS).optional().describe("For rules: must, should or never"),
        severity: z.enum(ISSUE_SEVERITIES).optional().describe("For known issues"),
        targetId: z.string().optional().describe("Required for update and archive: the item being changed"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const store = await openStore(cwd);

        if (input.op === "create") {
          if (!input.type || !input.title) {
            return errorResult("A create proposal needs both a type and a title.");
          }
          const proposal = await proposeCreate(store, {
            draft: {
              type: input.type as KnowledgeTypeName,
              title: input.title,
              ...(input.body ? { body: input.body } : {}),
              ...(input.scopes?.length ? { scopes: input.scopes } : {}),
              ...(input.paths?.length ? { paths: input.paths } : {}),
              ...(input.tags?.length ? { tags: input.tags } : {}),
              ...(input.enforcement ? { enforcement: input.enforcement } : {}),
              ...(input.severity ? { severity: input.severity } : {}),
              source: "ai",
              provenance: { origin: "conversation", ref: agent.id },
            },
            proposedBy: agent,
            reason: input.reason,
          });
          return textResult(stagedMessage(proposal.id, renderDiff(proposalDiff(proposal))));
        }

        if (!input.targetId) {
          return errorResult(`A ${input.op} proposal needs the targetId of the item being changed.`);
        }

        const patch: Record<string, unknown> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.body !== undefined) patch.body = input.body;
        if (input.scopes?.length) patch.scopes = input.scopes;
        if (input.paths?.length) patch.paths = input.paths;
        if (input.tags?.length) patch.tags = input.tags;
        if (input.enforcement) patch.enforcement = input.enforcement;
        if (input.severity) patch.severity = input.severity;

        const proposal = await proposeChange(store, {
          targetRef: input.targetId,
          op: input.op,
          patch,
          proposedBy: agent,
          reason: input.reason,
        });
        const target = proposal.targetId ? store.get(proposal.targetId) : undefined;
        return textResult(stagedMessage(proposal.id, renderDiff(proposalDiff(proposal, target))));
      } catch (error) {
        return errorResult(describeError(error));
      }
    },
  );

  server.registerPrompt(
    "remember",
    {
      title: "Remember this about the project",
      description:
        "Turn something the developer just said into a proposed knowledge item for their review.",
      argsSchema: z.object({
        statement: z.string().describe("What the project should remember"),
      }),
    },
    ({ statement }) => {
      const suggestion = classifyStatement(statement);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Record this about the project: "${statement}"`,
                "",
                `A quick heuristic reads that as a ${suggestion.type}, because it ${suggestion.reason}.`,
                "Check that against the codebase and your own judgement before accepting it.",
                "",
                "Then call knowledge_propose with:",
                "- the type you actually think it is",
                "- a one line title, and the detail in the body",
                "- the narrowest scope that is still correct, using scopes this project already defines",
                "  (call knowledge_search or context_resolve first if you are unsure which exist)",
                "- a reason explaining where this came from",
                "",
                "The developer reviews the proposal before it becomes project knowledge, so tell them",
                "it is staged rather than claiming it has been saved.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerResource(
    "knowledge",
    new ResourceTemplate(`${KNOWLEDGE_URI_PREFIX}{id}`, {
      list: async () => {
        const store = await openStore(cwd);
        return {
          resources: store.list().map((item) => ({
            uri: `${KNOWLEDGE_URI_PREFIX}${item.id}`,
            name: item.title,
            description: `${item.type} · ${item.status} · ${item.scopes.join(", ")}`,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    {
      title: "Project knowledge item",
      description: "One rule, decision, architectural fact, domain concept, convention, context note or known issue",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      const store = await openStore(cwd);
      const item = store.resolveRef(String(id));
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: formatItem(item) }],
      };
    },
  );

  return server;
}
