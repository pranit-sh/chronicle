# codicil-cli

> Project knowledge for AI coding agents. A CLI for storing, checking and reviewing what your agents should remember.

[![npm version](https://img.shields.io/npm/v/codicil-cli.svg)](https://www.npmjs.com/package/codicil-cli)
[![license](https://img.shields.io/npm/l/codicil-cli.svg)](https://github.com/pranit-sh/codicil/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/codicil-cli)](https://www.npmjs.com/package/codicil-cli)
[![Issues](https://img.shields.io/github/issues/pranit-sh/codicil.svg)](https://github.com/pranit-sh/codicil/issues)

Codicil keeps project knowledge as Markdown in `.codicil/`, committed alongside
your code. Use the CLI to:

- **initialize** a versioned knowledge layer in any repo.
- **remember** rules, decisions, architecture, conventions, context and issues.
- **resolve context** for a file or task before an agent edits.
- **verify** evidence checks against the working tree.
- **review proposals** staged by agents over MCP.

---

## Install

```bash
npm install -g codicil-cli
```

Or run without installing:

```bash
npx codicil-cli --help
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
- **[Codicil for VS Code](https://marketplace.visualstudio.com/items?itemName=pranit-sh.codicil-vscode)** — a UI to review proposals and browse context.

See the **[project README](https://github.com/pranit-sh/codicil#readme)** for the full picture.

## Issues & feature requests

Found a bug or want a new feature? **[Open an issue on GitHub](https://github.com/pranit-sh/codicil/issues/new/choose)**.

## Support

If Codicil saved you a headache, you can [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-BD5FFF?style=flat&logo=buy-me-a-coffee&logoColor=ffffff&labelColor=BD5FFF)](https://www.buymeacoffee.com/pranit.sh) — it keeps the knowledge flowing.

## License

[MIT](https://github.com/pranit-sh/codicil/blob/main/LICENSE)
