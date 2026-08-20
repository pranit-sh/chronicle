# Chronicle for VS Code

See, review and control what your AI coding agents are told about your project.

Chronicle keeps project knowledge — rules, decisions, architecture, conventions
— as Markdown in `.chronicle/`, committed alongside your code. This extension is
the window onto it.

## What it gives you

**Knowledge** — everything the project knows, grouped by type, status or scope.
Open an item to read the full Markdown record, edit it, verify it or archive it.

**Proposals** — when an agent notices something worth remembering it can stage a
proposal here without waiting for an explicit “remember this” request. Nothing
an agent proposes reaches your knowledge base until you accept it. Every
proposal opens as a diff showing exactly what would land.

**Active context** — the exact package an agent would receive for the file you
are editing, in the order it would see it, including what was left out for the
budget and why. This is the transparency view: no hidden prompt.

**Guide** — the in-product reference for the Chronicle workflow, command
palette actions, verification check syntax and agent setup.

## Getting started

1. Run **Chronicle: Set up the knowledge layer** from the command palette.
2. Open **Chronicle: Open Guide** and use the setup buttons for Copilot,
  Cursor, Claude Code or the generic MCP snippet.
3. Optional: use the guide’s agent-instructions button to add Chronicle guidance
  to `CLAUDE.md`, `.github/copilot-instructions.md` or a Cursor project rule.
4. Let connected agents stage proposals when conversation facts are worth
  remembering, or use **Chronicle: Remember this** to capture one manually.
5. Open **Chronicle: Open Guide** for available actions, check syntax and
  agent setup snippets.
6. Commit `.chronicle/`. Knowledge now follows branches, reviews and merges the
   same way your code does.

## Verification checks

Verification checks are stored in the Markdown frontmatter under `evidence`.
Chronicle can check files, globs, regex patterns and commits against the working
tree without calling an AI model.

```yaml
evidence:
  - kind: file
   path: "src/server.ts"
   expect: present
  - kind: grep
   glob: "src/api/**/*.ts"
   pattern: "from ['\"]@/db"
   expect: absent
   note: "API handlers should not import the database layer directly"
```

`expect: present` means the file, glob, pattern or commit must still exist.
`expect: absent` means the pattern must stay out of the matching files. Use
`minMatches` and `maxMatches` when a present check needs a specific match count.

The Copilot command creates `.vscode/mcp.json` like this:

```json
{
  "servers": {
    "chronicle": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@chronicle/mcp"],
      "cwd": "${workspaceFolder}",
      "env": {
        "CHRONICLE_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

Clients that use the common MCP `mcpServers` shape can use:

```json
{
  "mcpServers": {
    "chronicle": {
      "command": "npx",
      "args": ["-y", "@chronicle/mcp"],
      "env": {
        "CHRONICLE_ROOT": "/absolute/path/to/your/repo"
      }
    }
  }
}
```

The Cursor command creates `.cursor/mcp.json` in the workspace. The Claude Code
command creates `.mcp.json` at the project root, which Claude Code treats as a
project-scoped MCP server after workspace approval.

Agents then get project knowledge through MCP tools such as `context_resolve`,
`knowledge_search`, `knowledge_get` and `knowledge_propose`. They are instructed
to call `context_resolve` before planning or editing, and to stage a
`knowledge_propose` proposal whenever they judge that conversation information
is durable project knowledge. The extension is the human review UI; the MCP
server is the agent integration.

Tool use still depends on the agent client and model. If an agent ignores the
instructions, nudge it directly with “Use Chronicle context for this task” or
“Propose this to Chronicle if it should persist.”

The instructions command preserves existing project guidance and adds an
idempotent Chronicle block telling agents to proactively use `context_resolve`,
`knowledge_search`, `knowledge_get` and `knowledge_propose` when project
knowledge may affect the task or when the conversation reveals knowledge worth
reviewing. It can write `CLAUDE.md`, `.github/copilot-instructions.md` or
`.cursor/rules/chronicle.mdc`.

## Commands

| Command | What it does |
| --- | --- |
| Chronicle: Remember this | Capture a fact, rule or decision |
| Chronicle: Open Guide | Show the workflow, available actions, verification check syntax and MCP setup snippets |
| Chronicle: What does the agent know here? | Open the resolved context package |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `chronicle.statusBar.enabled` | `true` | Show how many items apply to the current file |
| `chronicle.groupBy` | `type` | Group the knowledge tree by `type`, `status` or `scope` |

## Development

```bash
pnpm install
pnpm build
pnpm --filter chronicle-vscode test
```

Press <kbd>F5</kbd> in this folder to launch an Extension Development Host.
