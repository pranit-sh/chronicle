---
id: k_01M0A5D9640BYJZDGBJJZVMNS1
type: architecture
title: Scopes form a dotted hierarchy mapped onto code paths
status: active
lifetime: permanent
scopes:
  - core.resolver
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:57.731Z
updatedAt: 2026-08-18T12:20:58.859Z
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
    lastDetail: "file packages/core/src/scope.ts: 1 match"
    kind: file
    path: packages/core/src/scope.ts
---

An item scoped backend applies to everything resolving under backend.*, up to the implicit root scope named project. config.yaml maps each scope id to the code path globs that activate it, so opening src/backend/api/auth/login.ts activates project, backend, backend.api and backend.api.auth, and knowledge attached to any of them applies.
