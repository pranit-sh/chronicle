import { defineConfig } from "tsup";

export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  target: "node20",
  platform: "node",
  // The vsix ships without node_modules, so everything except the `vscode`
  // host module has to be bundled in. tsup would otherwise leave anything
  // listed under dependencies as a bare require that fails once installed.
  // noExternal wins over external, so `vscode` is excluded in the pattern
  // itself rather than listed below.
  noExternal: [/^(?!vscode$)/],
  external: ["vscode"],
  dts: false,
  // Bundling all of @codicil/core and its dependencies makes this large
  // enough that minifying is worth it; the source map keeps stacks readable.
  minify: true,
  sourcemap: true,
  clean: true,
});
