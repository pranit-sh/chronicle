---
id: k_01M0A5D8F23M8K74AK798DNMVQ
type: decision
title: Knowledge is Markdown with YAML frontmatter, not a database
status: active
decisionStatus: accepted
lifetime: permanent
scopes:
  - core.store
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:56.993Z
updatedAt: 2026-08-18T10:06:56.993Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: codicil remember
---

## Decision
One Markdown file per knowledge item under .codicil/knowledge, with YAML frontmatter, committed to Git.

## Rationale
The product thesis is Knowledge Git: knowledge has to diff, branch, review and merge like code, and a developer has to be able to open it in an editor. A single binary database is opaque in Git and produces no meaningful conflicts.

## Alternatives
SQLite as the source of truth, rejected because it defeats the versioning thesis. One JSON file per item, rejected as unpleasant to hand edit. An append-only JSONL event log, deferred as heavier than the MVP needs.

## Consequences
Queries need an index, so the store keeps an in-memory map rebuilt from disk and cached, keyed by mtime, in the gitignored .codicil/.cache.
