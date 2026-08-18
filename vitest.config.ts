import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@chronicle/core": resolve("./packages/core/src/index.ts"),
      "@chronicle/mcp": resolve("./packages/mcp/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
