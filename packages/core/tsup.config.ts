import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  // Declarations come from `tsc --emitDeclarationOnly`; tsup's dts bundler does
  // not support the TypeScript version this repo builds against.
  dts: false,
  sourcemap: true,
  clean: true,
});
