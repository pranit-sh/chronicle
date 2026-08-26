# codicil-mcp

> Project knowledge for AI coding agents, served over MCP.

[![npm version](https://img.shields.io/npm/v/codicil-mcp.svg)](https://www.npmjs.com/package/codicil-mcp)
[![license](https://img.shields.io/npm/l/codicil-mcp.svg)](https://github.com/pranit-sh/codicil/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/codicil-mcp)](https://www.npmjs.com/package/codicil-mcp)
[![Issues](https://img.shields.io/github/issues/pranit-sh/codicil.svg)](https://github.com/pranit-sh/codicil/issues)

Your agent forgets the decision you explained yesterday, suggests the library
you deliberately removed, and rebuilds the thing you already tried. This MCP
server fixes that by giving agents the project's real knowledge:

- **Rules** — binding constraints ("never call the database from an API handler").
- **Decisions** — settled choices, with the reasoning ("Postgres over MongoDB").
- **Architecture, domain, conventions** — how this project is actually built.
- **Context & known issues** — what's true right now, and what's broken.

Knowledge lives as Markdown in `.codicil/`, committed alongside your code. The
agent reads what applies to the file at hand and can stage new proposals — but
never writes to the knowledge base itself.

> **AI proposes, you dispose.** The server can *stage* knowledge for review, but
> it can never accept it. There is deliberately no accept tool, so an agent
> cannot ratify its own beliefs.

---

## Usage

Add the server to your MCP client. It runs over stdio via `npx`, so there is
nothing to install globally.

### Cursor — `.cursor/mcp.json`

```jsonc
{
  "mcpServers": {
    "codicil": {
      "command": "npx",
      "args": ["-y", "codicil-mcp"],
      "env": { "CODICIL_ROOT": "${workspaceFolder}" },
    },
  },
}
```

### VS Code / Copilot — `.vscode/mcp.json`

```jsonc
{
  "servers": {
    "codicil": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "codicil-mcp"],
      "env": { "CODICIL_ROOT": "${workspaceFolder}" },
    },
  },
}
```

> **Tip:** The [Codicil VS Code extension](https://marketplace.visualstudio.com/items?itemName=pranit-sh.codicil-vscode)
> writes these config files for you and adds a UI to review what agents propose.

---

## Tools

| Tool | Use it for |
| --- | --- |
| `context_resolve` | Default. The rules, decisions, conventions and known issues that apply to a file or task. Agents call it before planning or editing. |
| `knowledge_search` | Search stored knowledge by query, type or scope. |
| `knowledge_get` | Fetch a single knowledge item by id. |
| `knowledge_propose` | Stage a new or updated item for human review — nothing more. |

**Resource** — `codicil://knowledge/{id}` · **Prompt** — `remember`

The read tools are marked read-only. `knowledge_propose` writes a proposal to
`.codicil/proposals/` that a developer reviews and accepts, edits or rejects.

---

## Configuration

| Variable | Description |
| --- | --- |
| `CODICIL_ROOT` | Directory to search upwards from for `.codicil/`. Defaults to the process working directory. |

Diagnostics are written to `stderr`; `stdout` is reserved for the protocol.

---

## Programmatic API

```ts
import { createCodicilServer } from 'codicil-mcp';

const server = createCodicilServer({ cwd: process.cwd() });
// connect `server` to your transport of choice
```

---

## Learn more

Codicil is an open, developer-controlled knowledge layer that also ships a CLI
and a VS Code extension. See the
**[project README](https://github.com/pranit-sh/codicil#readme)** for the full
picture.

## Issues & feature requests

Found a bug or want a new feature? **[Open an issue on GitHub](https://github.com/pranit-sh/codicil/issues/new/choose)**.

## Support

If Codicil saved you a headache, you can [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-BD5FFF?style=flat&logo=buy-me-a-coffee&logoColor=ffffff&labelColor=BD5FFF)](https://www.buymeacoffee.com/pranit.sh) — it keeps the knowledge flowing.

## License

[MIT](https://github.com/pranit-sh/codicil/blob/main/LICENSE)
