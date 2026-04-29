import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ESM-native — no transform needed for .ts files when using ts-node/esm
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/tests/**", "src/bot.ts"],
    },
    // Print each test name while running
    reporters: ["verbose"],
  },
});
