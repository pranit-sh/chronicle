# Chronicle

A developer-controlled, versioned knowledge layer for AI coding agents.

Your agent forgets the architecture decision you explained yesterday, suggests
the library you deliberately removed, and confidently rebuilds the thing you
already tried. Not because it is bad at code, but because nobody ever wrote down
what this project actually is — and the places where you did write it down
(`CLAUDE.md`, a wiki, a Slack thread) go stale silently.

Chronicle makes that knowledge a real artifact: structured, versioned, checkable
against the code, and yours to control.

```
.chronicle/
  config.yaml                            scope map, budget, what agents may do
  knowledge/
    rules/no-direct-db-in-handlers.md
    decisions/postgres-over-mongodb.md
    architecture/ domain/ conventions/ context/ issues/
  proposals/pr_01J….yaml                 staged by agents, waiting on you
  history/2026-08-18.jsonl               append-only changelog
  archive/                               retired, kept for the record
```

It is Markdown with YAML frontmatter, committed alongside your code. Knowledge
follows branches, shows up in review, and merges the way code does.

## The four ideas

**Knowledge is typed.** A rule ("never call the database from an API handler")
is not the same thing as a decision ("Postgres over MongoDB, because…") or a
piece of temporary context ("we are mid-migration to Better Auth"). Chronicle
stores seven types and treats them differently when it decides what an agent
should see.

**Knowledge is scoped.** Items live at dotted scopes (`backend.api`,
`payments.stripe`) mapped onto code paths. A resolver picks what applies to the
file you are editing and packs it under a budget, so the agent gets 12 relevant
items rather than 200 irrelevant ones — and can explain every inclusion.

**Knowledge is checkable.** An item can carry evidence: a file that must exist,
a pattern that must not appear, a glob that must match. `chronicle verify`
re-runs those predicates against the working tree. Nothing is inferred by an
LLM; a failing check marks the item stale and asks you what to do.

**AI proposes, you dispose.** Agents reach Chronicle over MCP and can stage
proposals, never write. There is deliberately no accept tool, so an agent cannot
ratify its own beliefs.

## Getting started

```bash
pnpm install && pnpm build

node packages/cli/dist/bin.js init
node packages/cli/dist/bin.js remember "Never call the database directly from an API handler"
node packages/cli/dist/bin.js context --file src/api/users.ts
```

Point an agent at it by adding the MCP server to your client, for example
`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chronicle": {
      "command": "node",
      "args": ["packages/mcp/dist/bin.js"]
    }
  }
}
```

## Packages

| Package | Name | What it is |
| --- | --- | --- |
| `packages/core` | `@chronicle/core` | Schema, store, scope model, resolver, verifier, proposals, history, doctor |
| `packages/cli` | `chronicle` | The command line |
| `packages/mcp` | `@chronicle/mcp` | Stdio MCP server: read tools, a resource, and `knowledge_propose` |
| `packages/vscode` | Chronicle for VS Code | Knowledge tree, proposal review, active-context view |

## The command line

```
init                              create .chronicle/ in this project
remember "<text>"                 capture knowledge, classified automatically
list / show <ref>                 browse what the project knows
context --file <path> --task …    exactly what an agent would receive
evidence add <ref> --grep … --in …    attach a check
verify [refs…]                    re-check knowledge against the code
proposals / diff / accept / reject    review what agents staged
history                           the changelog
doctor                            merge conflicts, broken files, dangling refs
archive / restore / delete        lifecycle
serve                             run the MCP server on stdio
```

Every command takes `--json`.

## The MCP surface

Read tools: `context_resolve(file?, task?, openFiles?, branch?)`,
`knowledge_search(query, type?, scope?)`, `knowledge_get(id)`.
Write tool: `knowledge_propose(...)`, which stages a proposal and nothing more,
gated by `authority.autoLearn` in `config.yaml`. Agents are instructed to call
`context_resolve` before planning or editing and to stage `knowledge_propose`
when they judge that conversation information is durable project knowledge;
they do not need to wait for an explicit “remember this” request.
Tool use is still ultimately controlled by the agent client and model. If an
agent skips Chronicle, prompt it explicitly: “Use Chronicle context for this
task” or “Propose this to Chronicle if it should persist.”
Resource: `chronicle://knowledge/{id}`. Prompt: `remember`.

## What an item looks like

```yaml
---
id: k_01J8ZQ4M7X
type: rule
title: Never call the database directly from an API handler
status: active
scopes: [backend.api]
enforcement: never
source: human
evidence:
  - { kind: grep, glob: "src/api/**/*.ts", pattern: "db\\.", expect: absent }
---

Handlers call the repository layer. It owns transactions and retries, and it is
the only place that knows about connection pooling.
```

The frontmatter is validated by a Zod discriminated union in
`packages/core/src/schema.ts`, which is the single source of truth for the CLI,
the MCP tool schemas and the extension alike.

## Development

```bash
pnpm build        # all packages
pnpm typecheck
pnpm test         # unit tests, then the VS Code smoke test against the bundle
pnpm test:unit    # just the fast ones
```

Chronicle dogfoods itself: this repository has its own `.chronicle/`, and the
rules in it are verified by `chronicle verify` against this codebase.

## License

MIT
