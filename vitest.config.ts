import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Entry point and constants carry no logic. The i18n tables are JSON and
      // so are not matched by `include` at all.
      exclude: ["src/index.ts", "src/config/env.ts"],
    },
  },
});
