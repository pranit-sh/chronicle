# codicil

> The command line for Codicil — a developer-controlled, versioned knowledge layer for your AI coding agents.

[![npm version](https://img.shields.io/npm/v/codicil.svg)](https://www.npmjs.com/package/codicil)
[![license](https://img.shields.io/npm/l/codicil.svg)](https://github.com/pranit-sh.codicil/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/codicil)](https://www.npmjs.com/package/codicil)
[![Issues](https://img.shields.io/github/issues/pranit-sh.codicil.svg)](https://github.com/pranit-sh.codicil/issues)

Codicil keeps a project's knowledge — rules, decisions, architecture,
conventions, domain concepts, current context and known issues — as Markdown in
`.codicil/`, committed alongside your code. This CLI initializes that store,
reviews what agents propose, and inspects what's known.

---

## Install

```bash
npm install -g codicil
```

Or run without installing:

```bash
npx codicil --help
```

Node.js ≥ 18.

---

## Quick start

```bash
# Set up .codicil/ in the current repo
codicil init

# See what applies to a file or task
codicil context src/api/handler.ts

# Review, accept, edit or reject agent proposals
codicil proposals

# List and inspect stored knowledge
codicil list
codicil show <id>

# Health check the store and its links
codicil doctor
codicil verify
```

Run `codicil --help` or `codicil <command> --help` for the full set of
commands and flags.

---

## How it fits together

Codicil also ships:

- **[codicil-mcp](https://www.npmjs.com/package/codicil-mcp)** — an MCP server so agents read this knowledge directly.
- **[Codicil for VS Code](https://marketplace.visualstudio.com/items?itemName=pranit-sh.codicil)** — a UI to review proposals and browse context.

See the **[project README](https://github.com/pranit-sh.codicil#readme)** for the full picture.

## Issues & feature requests

Found a bug or want a new feature? **[Open an issue on GitHub](https://github.com/pranit-sh.codicil/issues/new/choose)**.

## Support

If Codicil saved you a headache, you can [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-BD5FFF?style=flat&logo=buy-me-a-coffee&logoColor=ffffff&labelColor=BD5FFF)](https://www.buymeacoffee.com/pranit.sh) — it keeps the knowledge flowing.

## License

[MIT](https://github.com/pranit-sh.codicil/blob/main/LICENSE)
