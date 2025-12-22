import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  dts: true,
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  target: "node20",
  tsconfig: "tsconfig.build.json",
  esbuildOptions(options) {
    options.packages = "external";
  },
});
