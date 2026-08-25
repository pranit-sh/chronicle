---
id: k_01M0A5D8WDW8ZXRR3JKVX7ZKN4
type: decision
title: Type declarations are emitted by tsc, not by the tsup dts bundler
status: active
decisionStatus: accepted
lifetime: permanent
scopes:
  - build
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:57.420Z
updatedAt: 2026-08-18T10:06:57.420Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: codicil remember
---

## Decision
Each package builds JavaScript with tsup and declarations with tsc -p tsconfig.build.json.

## Rationale
tsup delegates declaration bundling to rollup-plugin-dts, which crashes on the TypeScript version this repo builds against. Splitting the two steps costs one extra command and removes the dependency entirely.
