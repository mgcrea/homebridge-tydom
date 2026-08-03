import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // Homebridge is supplied by the host at runtime and is only ever imported for
  // its types. It is deliberately not a peer dependency — npm refuses to resolve
  // `^2.0.0` against a prerelease like 2.3.0-beta.1, which blocks installs on
  // Homebridge betas — so it has to be externalised explicitly here.
  deps: { neverBundle: ["homebridge"] },
  target: "node22",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
});
