import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: false,
  sourcemap: true,
  clean: true,
  // @codicil/core is private and never published, so it must be bundled in.
  // That pulls CommonJS deps (yaml, picomatch, ...) into an ESM output, so we
  // recreate `require` for the bundled CJS shims.
  noExternal: [/^@codicil\//],
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __cjsCreateRequire } from 'node:module';",
      "const require = __cjsCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
