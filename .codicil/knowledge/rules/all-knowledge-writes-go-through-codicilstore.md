---
id: k_01M0A5D81Q7AV98DQKRV9CTKHM
type: rule
title: All knowledge writes go through CodicilStore
status: active
enforcement: must
lifetime: permanent
scopes:
  - core
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:56.566Z
updatedAt: 2026-08-18T12:20:58.853Z
lastVerifiedAt: 2026-08-18T12:20:58.832Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: codicil remember
evidence:
  - expect: present
    lastCheckedAt: 2026-08-18T12:20:58.832Z
    lastResult: pass
    lastDetail: "file packages/core/src/store.ts: 1 match"
    kind: file
    path: packages/core/src/store.ts
---

Never touch files under .codicil/knowledge with fs directly. The store owns id generation, slug uniqueness, atomic writes, archive moves, the index and the history log; bypassing it desynchronises all five.
