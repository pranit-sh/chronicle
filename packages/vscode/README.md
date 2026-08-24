# Chronicle for VS Code

See, review and control what your AI coding agents are told about your project.

Chronicle keeps project knowledge — rules, decisions, architecture, conventions
— as Markdown in `.chronicle/`, committed alongside your code. This extension is
the window onto it.

## What it gives you

**Knowledge** — everything the project knows, grouped by type, status or scope.
Open an item to read the full Markdown record, edit it, verify it or archive it.

**Proposals** — agents stage what they judge worth remembering, without waiting
for an explicit “remember this”. Nothing reaches the knowledge base until you
accept it, and every proposal opens as a diff showing exactly what would land.

**Active context** — the exact package an agent would receive for the file you
are editing, in the order it would see it, including what was left out for the
budget and why. This is the transparency view: no hidden prompt.

**Guide** — one-click MCP setup for Copilot, Cursor and Claude Code, plus the
workflow, the available actions and the verification check syntax.

## Getting started

1. Run **Chronicle: Set up the knowledge layer** from the command palette.
2. Open **Chronicle: Open Guide** and use the setup buttons to connect an agent.
3. Commit `.chronicle/`. Knowledge now follows branches, reviews and merges the
   same way your code does.

Connected agents resolve context and stage proposals on their own. **Chronicle:
Remember this** captures something manually.

## Development

```bash
pnpm install
pnpm build
pnpm --filter chronicle-vscode test
```

Press <kbd>F5</kbd> for an Extension Development Host, then open a folder
containing `.chronicle/config.yaml` — the debug window starts empty and the
extension activates on that file. To install a build into your own editor
instead, `pnpm --filter chronicle-vscode package` writes an installable `.vsix`.
