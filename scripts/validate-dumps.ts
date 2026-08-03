#! /usr/bin/env node
/**
 * Replay real gateway dumps through the discovery schemas and resolver.
 *
 * The schemas on /configs/file, /groups/file and /devices/meta are only worth
 * having if they accept every gateway in the wild — a schema that rejects real
 * hardware is worse than no schema at all. Run this after touching
 * api/types.ts or the signature table in api/device-type.ts.
 *
 * Dumps are not committed (they carry room names and device ids from real
 * homes); point this at wherever yours live.
 *
 * Usage: pnpm tsx scripts/validate-dumps.ts [dump-dir]
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { discoverDevices } from "../src/api/discovery.js";
import {
  parseDiscoveryResponse,
  tydomConfigResponseSchema,
  tydomGroupsResponseSchema,
  tydomMetaResponseSchema,
} from "../src/api/types.js";

const [dumpDir = ".idea/dumps"] = process.argv.slice(2);

let ok = 0;
let failed = 0;

for (const file of readdirSync(dumpDir)
  .filter((f) => extname(f) === ".json")
  .toSorted()) {
  const dump = JSON.parse(readFileSync(join(dumpDir, file), "utf8")) as Record<string, unknown>;
  try {
    const config = parseDiscoveryResponse(
      "/configs/file",
      tydomConfigResponseSchema,
      dump["/configs/file"],
    );
    const groups = parseDiscoveryResponse(
      "/groups/file",
      tydomGroupsResponseSchema,
      dump["/groups/file"] ?? { groups: [] },
    );
    const meta = parseDiscoveryResponse(
      "/devices/meta",
      tydomMetaResponseSchema,
      dump["/devices/meta"],
    );
    const { devices, skipped } = discoverDevices({
      username: "012345ABCDEF",
      config,
      groups,
      meta,
    });
    const unsupported = skipped.filter((s) => s.reason === "unsupported");
    console.log(
      `  ok   ${file.padEnd(22)} endpoints=${String(config.endpoints.length).padStart(3)}` +
        `  discovered=${String(devices.length).padStart(3)}  unsupported=${unsupported.length}`,
    );
    for (const s of unsupported) {
      console.log(`         unsupported firstUsage="${s.firstUsage}" deviceId=${s.deviceId}`);
    }
    ok += 1;
  } catch (err) {
    console.log(`  FAIL ${file.padEnd(22)} ${(err as Error).message.slice(0, 200)}`);
    failed += 1;
  }
}

console.log(`\n${ok} parsed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
