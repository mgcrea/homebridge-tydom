import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  dts: true,
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  target: "node22",
  esbuildOptions(options) {
    options.packages = "external";
  },
});
