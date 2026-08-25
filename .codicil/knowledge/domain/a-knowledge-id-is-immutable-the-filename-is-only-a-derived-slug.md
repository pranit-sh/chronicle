---
id: k_01M0A5D9EE2CH7TADY6PJXW2Z3
type: domain
title: A knowledge id is immutable; the filename is only a derived slug
status: active
lifetime: permanent
scopes:
  - core.store
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:57.997Z
updatedAt: 2026-08-18T10:06:57.997Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: codicil remember
---

Each item carries a ULID based id in its frontmatter that never changes. The filename is a slug of the title, kept readable for Git diffs, and the store renames it when the title changes. Never key anything off the filename.
