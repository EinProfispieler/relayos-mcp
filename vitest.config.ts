import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".vite-temp",
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
