import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Entry point and constants carry no logic; the i18n tables are pure data.
      exclude: ["src/index.ts", "src/config/env.ts", "src/config/i18n/**"],
    },
  },
});
