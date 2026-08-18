---
id: k_01M0A5D7RBM59RAHPEFQ2JW6H8
type: rule
title: Never write anything but protocol messages to stdout in the MCP server
status: active
enforcement: never
lifetime: permanent
scopes:
  - mcp
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:56.266Z
updatedAt: 2026-08-18T12:20:58.857Z
lastVerifiedAt: 2026-08-18T12:20:58.832Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: chronicle remember
evidence:
  - expect: absent
    lastCheckedAt: 2026-08-18T12:20:58.832Z
    lastResult: pass
    lastDetail: "/console\\.log|process\\.stdout\\.write/ in packages/mcp/src/**/*.ts: still absent"
    kind: grep
    glob: packages/mcp/src/**/*.ts
    pattern: console\.log|process\.stdout\.write
---

stdout is the MCP transport. Every diagnostic, warning and log line goes to stderr, or it will corrupt the session.
