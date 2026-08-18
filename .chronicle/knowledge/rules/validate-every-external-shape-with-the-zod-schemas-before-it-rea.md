---
id: k_01M0A5D864KS4EA08E8AJQJZKA
type: rule
title: Validate every external shape with the Zod schemas before it reaches the store
status: active
enforcement: must
lifetime: permanent
scopes:
  - project
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:56.707Z
updatedAt: 2026-08-18T12:20:58.866Z
lastVerifiedAt: 2026-08-18T12:20:58.832Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: chronicle remember
evidence:
  - expect: present
    lastCheckedAt: 2026-08-18T12:20:58.832Z
    lastResult: pass
    lastDetail: "file packages/core/src/schema.ts: 1 match"
    kind: file
    path: packages/core/src/schema.ts
---

packages/core/src/schema.ts is the single source of truth for every Chronicle data shape. CLI input, MCP tool arguments, YAML frontmatter and the index cache all parse through it, so a malformed file fails loudly at the boundary instead of corrupting knowledge.
