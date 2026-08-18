#!/usr/bin/env bash
# Recreates Chronicle's own knowledge layer from scratch.
#
# Chronicle dogfoods itself: this repository's rules, decisions and conventions
# live in .chronicle/ and are served to coding agents over MCP. Editing the
# Markdown in .chronicle/knowledge by hand is expected and supported; this script
# exists so the seed set can be rebuilt or reviewed as a whole.
set -euo pipefail

cd "$(dirname "$0")/.."
CLI="node packages/cli/dist/bin.js"

if [ -d .chronicle ]; then
  echo "refusing to overwrite the existing .chronicle; remove it first" >&2
  exit 1
fi

$CLI init >/dev/null

cat > .chronicle/config.yaml <<'YAML'
# Chronicle configuration. This file is committed, so knowledge settings
# travel with the branch just like the knowledge itself.
version: 1

# Map a scope id to the code paths that activate it. Scopes are dotted paths,
# and an item scoped "core" applies to anything resolving under "core.*".
scopes:
  core: ["packages/core/**"]
  core.schema: ["packages/core/src/schema.ts"]
  core.store: ["packages/core/src/store.ts", "packages/core/src/frontmatter.ts"]
  core.resolver: ["packages/core/src/resolver.ts", "packages/core/src/scope.ts"]
  core.verifier: ["packages/core/src/verifier.ts", "packages/core/src/evidence.ts"]
  mcp: ["packages/mcp/**"]
  cli: ["packages/cli/**"]
  tests: ["packages/*/test/**"]
  build: ["**/tsup.config.ts", "**/tsconfig*.json", "pnpm-workspace.yaml", "**/package.json"]

budget:
  maxItems: 25
  maxChars: 8000

authority:
  autoLearn: true
  autoModifyRules: false
  autoArchiveStale: false
  detectContradictions: true

resolver:
  includeStale: true
  includeProposed: false
  freshnessHorizonDays: 90

exclude:
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/.git/**"
  - "**/.env*"
  - "**/*.pem"
  - "**/*.key"
YAML

remember() { $CLI remember "$@" >/dev/null; }

# --- Rules ----------------------------------------------------------------

remember "The Markdown in .chronicle/knowledge is the only source of truth" \
  --type rule --scope core.store --enforcement must --pin \
  --body "The in-memory index and .chronicle/.cache/index.json are derived. Both can be deleted at any time and must be rebuilt from the Markdown, never the other way round. A developer editing a knowledge file by hand is a supported workflow, not an edge case."

remember "Never write anything but protocol messages to stdout in the MCP server" \
  --type rule --scope mcp --enforcement never \
  --body "stdout is the MCP transport. Every diagnostic, warning and log line goes to stderr, or it will corrupt the session."

remember "Agents may only stage proposals, never accept them" \
  --type rule --scope mcp --enforcement never --pin \
  --body "The MCP server deliberately exposes no accept, edit or delete tool. An agent can write to .chronicle/proposals and nowhere else, so a human always decides what the project believes. Adding a tool that mutates .chronicle/knowledge directly would break the core product promise."

remember "All knowledge writes go through ChronicleStore" \
  --type rule --scope core --enforcement must \
  --body "Never touch files under .chronicle/knowledge with fs directly. The store owns id generation, slug uniqueness, atomic writes, archive moves, the index and the history log; bypassing it desynchronises all five."

remember "Validate every external shape with the Zod schemas before it reaches the store" \
  --type rule --enforcement must \
  --body "packages/core/src/schema.ts is the single source of truth for every Chronicle data shape. CLI input, MCP tool arguments, YAML frontmatter and the index cache all parse through it, so a malformed file fails loudly at the boundary instead of corrupting knowledge."

remember "Relative imports must carry the .js extension" \
  --type rule --enforcement must \
  --body "Every package is NodeNext ESM with verbatimModuleSyntax, so relative imports need an explicit .js extension and type-only imports need the import type form."

# --- Decisions ------------------------------------------------------------

remember "Knowledge is Markdown with YAML frontmatter, not a database" \
  --type decision --scope core.store --body "## Decision
One Markdown file per knowledge item under .chronicle/knowledge, with YAML frontmatter, committed to Git.

## Rationale
The product thesis is Knowledge Git: knowledge has to diff, branch, review and merge like code, and a developer has to be able to open it in an editor. A single binary database is opaque in Git and produces no meaningful conflicts.

## Alternatives
SQLite as the source of truth, rejected because it defeats the versioning thesis. One JSON file per item, rejected as unpleasant to hand edit. An append-only JSONL event log, deferred as heavier than the MVP needs.

## Consequences
Queries need an index, so the store keeps an in-memory map rebuilt from disk and cached, keyed by mtime, in the gitignored .chronicle/.cache."

remember "Agents reach Chronicle over MCP, not through generated instruction files" \
  --type decision --scope mcp --body "## Decision
The first delivery mechanism is an MCP stdio server exposing context_resolve, knowledge_search, knowledge_get and knowledge_propose.

## Rationale
MCP is agent agnostic, so Cursor, Claude Code and Codex all work on day one with no editor lock-in. It is also task aware: a static file cannot vary its content by the file being edited or the job being done.

## Alternatives
Generating AGENTS.md, rejected for the MVP because it cannot vary by file or task, though it remains a reasonable second adapter. The VS Code Language Model Tools API, deferred because it serves only one editor."

remember "Staleness detection is deterministic and never calls a model" \
  --type decision --scope core.verifier --body "## Decision
Evidence predicates are re-checked against the working tree using globs, file existence, regex search and commit lookups.

## Rationale
No API keys, reproducible results, fast enough to run on every commit, and testable with fixtures. An expect:absent predicate that starts matching is precisely a contradiction, so one mechanism covers both staleness and contradiction detection.

## Consequences
Semantic drift that leaves no textual trace goes undetected. The verifier is written behind an interface so a model backed checker can be added later without changing the data model."

remember "Type declarations are emitted by tsc, not by the tsup dts bundler" \
  --type decision --scope build --body "## Decision
Each package builds JavaScript with tsup and declarations with tsc -p tsconfig.build.json.

## Rationale
tsup delegates declaration bundling to rollup-plugin-dts, which crashes on the TypeScript version this repo builds against. Splitting the two steps costs one extra command and removes the dependency entirely."

# --- Architecture ---------------------------------------------------------

remember "Chronicle is a pnpm monorepo of three packages" \
  --type architecture --scope project \
  --body "@chronicle/core holds the schema, store, scope model, resolver, verifier and history. @chronicle/mcp serves that core to coding agents over MCP. The chronicle CLI drives all of it from a terminal and can start the MCP server with chronicle serve. Core depends on nothing but zod, yaml, picomatch and ulid, so it can be embedded in a VS Code extension later without dragging in a server."

remember "Scopes form a dotted hierarchy mapped onto code paths" \
  --type architecture --scope core.resolver \
  --body "An item scoped backend applies to everything resolving under backend.*, up to the implicit root scope named project. config.yaml maps each scope id to the code path globs that activate it, so opening src/backend/api/auth/login.ts activates project, backend, backend.api and backend.api.auth, and knowledge attached to any of them applies."

# --- Domain ---------------------------------------------------------------

remember "A knowledge id is immutable; the filename is only a derived slug" \
  --type domain --scope core.store \
  --body "Each item carries a ULID based id in its frontmatter that never changes. The filename is a slug of the title, kept readable for Git diffs, and the store renames it when the title changes. Never key anything off the filename."

# --- Conventions ----------------------------------------------------------

remember "Tests live in packages/*/test and run with Vitest from the repo root" \
  --type convention --scope tests \
  --body "The root vitest.config.ts aliases @chronicle/core to its source, so tests run against the current source without building first. Store and MCP tests work against a real temporary .chronicle directory rather than mocking the filesystem."

remember "The resolver explains every inclusion and every exclusion" \
  --type convention --scope core.resolver \
  --body "Each resolved entry carries its component signal scores and human readable reasons, and every dropped candidate carries why it was dropped. This is what chronicle context --trace prints, and it is what makes scoring changes testable with fixtures instead of judged by feel."

# --- Known issues ---------------------------------------------------------

remember "The tsup dts bundler crashes on this repo's TypeScript version" \
  --type issue --scope build --severity medium \
  --body "rollup-plugin-dts, which tsup uses for declaration bundling, throws a TypeError reading useCaseSensitiveFileNames. Workaround: dts is disabled in every tsup.config.ts and declarations come from tsc -p tsconfig.build.json instead. Revisit if tsup switches away from rollup-plugin-dts."

$CLI list
