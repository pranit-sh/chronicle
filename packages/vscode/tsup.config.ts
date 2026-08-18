import { defineConfig } from "tsup";

export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  target: "node20",
  platform: "node",
  // VS Code loads extensions as CommonJS, and @chronicle/core is ESM only, so
  // it has to be bundled in rather than required at runtime.
  noExternal: ["@chronicle/core"],
  external: ["vscode"],
  dts: false,
  // Bundling all of @chronicle/core and its dependencies makes this large
  // enough that minifying is worth it; the source map keeps stacks readable.
  minify: true,
  sourcemap: true,
  clean: true,
});
