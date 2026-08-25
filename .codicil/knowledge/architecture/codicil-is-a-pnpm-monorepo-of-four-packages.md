---
id: k_01M0A5D90ZB8MZ6KWC7H17GP1W
type: architecture
title: Codicil is a pnpm monorepo of four packages
status: active
lifetime: permanent
scopes:
  - project
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:57.566Z
updatedAt: 2026-08-18T12:20:58.855Z
lastVerifiedAt: 2026-08-18T12:20:58.832Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: codicil remember
evidence:
  - expect: present
    minMatches: 3
    lastCheckedAt: 2026-08-18T12:20:58.832Z
    lastResult: pass
    lastDetail: "glob packages/*/package.json: 4 matches"
    kind: glob
    glob: packages/*/package.json
---

@codicil/core holds the schema, store, scope model, resolver, verifier and history. codicil-mcp serves that core to coding agents over MCP. The codicil CLI drives all of it from a terminal and can start the MCP server with codicil serve. codicil-vscode wraps the same core in a VS Code extension. Core depends on nothing but zod, yaml, picomatch and ulid, so it can be embedded in a VS Code extension without dragging in a server.
