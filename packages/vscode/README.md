# Chronicle for VS Code

See, review and control what your AI coding agents are told about your project.

Chronicle keeps project knowledge — rules, decisions, architecture, conventions
— as Markdown in `.chronicle/`, committed alongside your code. This extension is
the window onto it.

## What it gives you

**Knowledge** — everything the project knows, grouped by type, status or scope.
The top row is a live summary: how much is in play, how much no longer matches
the code, how much is waiting for you.

**Proposals** — when an agent notices something worth remembering it stages a
proposal here. Nothing an agent proposes reaches your knowledge base until you
accept it. Every proposal opens as a diff showing exactly what would land.

**Active context** — the exact package an agent would receive for the file you
are editing, in the order it would see it, including what was left out for the
budget and why. This is the transparency view: no hidden prompt.

## Getting started

1. Run **Chronicle: Set up the knowledge layer** from the command palette.
2. Say something worth remembering with **Chronicle: Remember this**. Chronicle
   guesses the type and scope from the sentence and shows you its guess.
3. Commit `.chronicle/`. Knowledge now follows branches, reviews and merges the
   same way your code does.

To let agents read it, point them at the MCP server:

```json
{
  "mcpServers": {
    "chronicle": {
      "command": "npx",
      "args": ["-y", "@chronicle/mcp"]
    }
  }
}
```

## Commands

| Command | What it does |
| --- | --- |
| Chronicle: Remember this | Capture a fact, rule or decision |
| Chronicle: Remember the selected text | Same, seeded from your selection |
| Chronicle: What does the agent know here? | Open the resolved context package |
| Chronicle: Verify everything | Re-check stored knowledge against the code |
| Chronicle: Check the knowledge layer for problems | Merge conflicts, broken files, dangling references |

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
