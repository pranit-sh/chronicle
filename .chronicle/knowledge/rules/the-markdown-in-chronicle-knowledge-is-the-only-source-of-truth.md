---
id: k_01M0A5D7K65T0NW2VQM4DX4RZX
type: rule
title: The Markdown in .chronicle/knowledge is the only source of truth
status: active
enforcement: must
lifetime: permanent
scopes:
  - core.store
source: human
confidence: 0.9
priority: 50
pinned: true
createdAt: 2026-08-18T10:06:56.101Z
updatedAt: 2026-08-18T12:19:25.329Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: chronicle remember
---

The in-memory index and .chronicle/.cache/index.json are derived. Both can be deleted at any time and must be rebuilt from the Markdown, never the other way round. A developer editing a knowledge file by hand is a supported workflow, not an edge case.
