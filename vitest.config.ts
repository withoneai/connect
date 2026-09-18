import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@withone/connect/server": new URL("./src/server/index.ts", import.meta.url).pathname,
      "@withone/connect/next": new URL("./src/next.ts", import.meta.url).pathname,
      "@withone/connect": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
