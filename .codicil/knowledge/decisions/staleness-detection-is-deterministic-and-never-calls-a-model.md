---
id: k_01M0A5D8R3RN3KZ0WT609T2YBG
type: decision
title: Staleness detection is deterministic and never calls a model
status: active
decisionStatus: accepted
lifetime: permanent
scopes:
  - core.verifier
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:57.282Z
updatedAt: 2026-08-18T10:06:57.282Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: codicil remember
---

## Decision
Evidence predicates are re-checked against the working tree using globs, file existence, regex search and commit lookups.

## Rationale
No API keys, reproducible results, fast enough to run on every commit, and testable with fixtures. An expect:absent predicate that starts matching is precisely a contradiction, so one mechanism covers both staleness and contradiction detection.

## Consequences
Semantic drift that leaves no textual trace goes undetected. The verifier is written behind an interface so a model backed checker can be added later without changing the data model.
