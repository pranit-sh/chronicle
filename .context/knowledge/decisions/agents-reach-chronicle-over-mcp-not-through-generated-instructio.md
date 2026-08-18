---
id: k_01M0A5D8KTNF57TCZW8FP8QVSZ
type: decision
title: Agents reach Chronicle over MCP, not through generated instruction files
status: active
decisionStatus: accepted
lifetime: permanent
scopes:
  - mcp
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:57.145Z
updatedAt: 2026-08-18T10:06:57.145Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: chronicle remember
---

## Decision
The first delivery mechanism is an MCP stdio server exposing context_resolve, knowledge_search, knowledge_get and knowledge_propose.

## Rationale
MCP is agent agnostic, so Cursor, Claude Code and Codex all work on day one with no editor lock-in. It is also task aware: a static file cannot vary its content by the file being edited or the job being done.

## Alternatives
Generating AGENTS.md, rejected for the MVP because it cannot vary by file or task, though it remains a reasonable second adapter. The VS Code Language Model Tools API, deferred because it serves only one editor.
