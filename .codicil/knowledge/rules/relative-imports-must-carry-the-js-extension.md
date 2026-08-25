---
id: k_01M0A5D8AE03YZV4QMVGKRZQD2
type: rule
title: Relative imports must carry the .js extension
status: active
enforcement: must
lifetime: permanent
scopes:
  - project
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:56.845Z
updatedAt: 2026-08-18T10:06:56.845Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: codicil remember
---

Every package is NodeNext ESM with verbatimModuleSyntax, so relative imports need an explicit .js extension and type-only imports need the import type form.
