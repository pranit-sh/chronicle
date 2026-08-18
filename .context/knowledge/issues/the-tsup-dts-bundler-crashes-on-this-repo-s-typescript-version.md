---
id: k_01M0A5D9VREB5F8SWWN6CW98GX
type: issue
title: The tsup dts bundler crashes on this repo's TypeScript version
status: active
severity: medium
lifetime: permanent
scopes:
  - build
source: human
confidence: 0.9
priority: 50
createdAt: 2026-08-18T10:06:58.423Z
updatedAt: 2026-08-18T10:41:39.522Z
lastVerifiedAt: 2026-08-18T10:41:39.492Z
actor:
  kind: human
  id: Pranit Deshmukh
provenance:
  origin: command
  ref: chronicle remember
evidence:
  - expect: present
    lastCheckedAt: 2026-08-18T10:41:39.492Z
    lastResult: pass
    lastDetail: "/dts: false/ in packages/*/tsup.config.ts: 4 matches"
    kind: grep
    glob: packages/*/tsup.config.ts
    pattern: "dts: false"
---

rollup-plugin-dts, which tsup uses for declaration bundling, throws a TypeError reading useCaseSensitiveFileNames. Workaround: dts is disabled in every tsup.config.ts and declarations come from tsc -p tsconfig.build.json instead. Revisit if tsup switches away from rollup-plugin-dts.
