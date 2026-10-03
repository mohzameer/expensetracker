import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // "server-only" throws outside a React Server Component; tests may import the queries directly.
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js") } },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
