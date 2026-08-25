---
id: k_01M0A5D9JPMBM3PDSB3DYS30TV
type: convention
title: Tests live in packages/*/test and run with Vitest from the repo root
status: active
lifetime: permanent
scopes:
  - tests
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:58.133Z
updatedAt: 2026-08-18T12:20:58.861Z
lastVerifiedAt: 2026-08-18T12:20:58.832Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: codicil remember
evidence:
  - expect: present
    minMatches: 1
    lastCheckedAt: 2026-08-18T12:20:58.832Z
    lastResult: pass
    lastDetail: "glob packages/*/test/**/*.test.ts: 9 matches"
    kind: glob
    glob: packages/*/test/**/*.test.ts
---

The root vitest.config.ts aliases @codicil/core to its source, so tests run against the current source without building first. Store and MCP tests work against a real temporary .codicil directory rather than mocking the filesystem.
