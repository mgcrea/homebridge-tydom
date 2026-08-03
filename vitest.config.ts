import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    // TODO(phase-3): drop this once the first specs land. Until then `pnpm test`
    // and CI would fail on an empty suite.
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Entry point and constants carry no logic; the i18n tables are pure data.
      exclude: ["src/index.ts", "src/config/env.ts", "src/config/i18n/**"],
    },
  },
});
