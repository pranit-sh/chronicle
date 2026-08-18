---
id: k_01M0A5D7X09VSHTNAQBY0Y70FY
type: rule
title: Agents may only stage proposals, never accept them
status: active
enforcement: never
lifetime: permanent
scopes:
  - mcp
source: human
confidence: 0.9
priority: 50
pinned: true
createdAt: 2026-08-18T10:06:56.416Z
updatedAt: 2026-08-18T10:41:39.507Z
lastVerifiedAt: 2026-08-18T10:41:39.492Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: chronicle remember
evidence:
  - expect: absent
    lastCheckedAt: 2026-08-18T10:41:39.492Z
    lastResult: pass
    lastDetail: "/registerTool\\(\\s*[\"'](knowledge_accept|knowledge_delete)/ in packages/mcp/src/**/*.ts: still absent"
    kind: grep
    glob: packages/mcp/src/**/*.ts
    pattern: registerTool\(\s*["'](knowledge_accept|knowledge_delete)
---

The MCP server deliberately exposes no accept, edit or delete tool. An agent can write to .context/proposals and nowhere else, so a human always decides what the project believes. Adding a tool that mutates .context/knowledge directly would break the core product promise.
