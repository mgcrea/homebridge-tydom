#! /usr/bin/env node
/**
 * Derive test fixtures from real user device dumps.
 *
 * The dumps themselves are not committed: they carry room names, catalog ids and
 * device ids from real homes. What the tests actually need is only the
 * resolution input — `first_usage` plus the endpoint's metadata property names —
 * so that is all this extracts.
 *
 * The `expected` field is deliberately *not* computed here. It is the
 * pre-refactor result, captured once from the released implementation, so that
 * test/device-type.spec.ts is a characterisation test rather than a tautology.
 * Regenerating inputs preserves any existing expectations by signature hash.
 *
 * Usage: pnpm tsx scripts/build-fixtures.ts [dump-dir] [out-file]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { getEndpointSignatureFromMetadata } from "../src/api/device-type.js";
import { sha256Sync } from "../src/util/hash.js";
import type { TydomConfigResponse, TydomMetaElement, TydomMetaResponse } from "../src/api/types.js";

type DumpFormat = {
  "/configs/file": TydomConfigResponse;
  "/devices/meta": TydomMetaResponse;
};

export type EndpointFixture = {
  /** The GitHub handle that reported the dump; already public in the source table. */
  source: string;
  firstUsage: string;
  /** Metadata property names, in the order the gateway sent them. */
  metadataNames: string[];
  /** `level.step`, the only metadata attribute resolution reads beyond names. */
  levelStep?: number;
  signature: string;
  signatureHash: string;
  /** Captured from the released implementation. `null` means "unsupported". */
  expected: {
    deviceType: string;
    category: number;
    impliedSettings: Record<string, unknown>;
  } | null;
};

const [dumpDir = ".idea/dumps", outFile = "test/fixtures/endpoint-signatures.json"] =
  process.argv.slice(2);

const previous: Map<string, EndpointFixture["expected"]> = new Map();
if (existsSync(outFile)) {
  const existing = JSON.parse(readFileSync(outFile, "utf8")) as EndpointFixture[];
  for (const f of existing) previous.set(f.signatureHash, f.expected);
}

const fixtures: EndpointFixture[] = [];
const seen = new Set<string>();

for (const file of readdirSync(dumpDir)
  .filter((f) => extname(f) === ".json")
  .toSorted()) {
  const dump = JSON.parse(readFileSync(join(dumpDir, file), "utf8")) as DumpFormat;
  const config = dump["/configs/file"];
  const meta = dump["/devices/meta"];
  if (!config?.endpoints || !meta) {
    console.warn(`skipping ${file}: missing /configs/file or /devices/meta`);
    continue;
  }

  for (const device of meta) {
    for (const endpoint of device.endpoints) {
      const configEndpoint = config.endpoints.find(
        (e) => e.id_device === device.id && e.id_endpoint === endpoint.id,
      );
      if (!configEndpoint) continue;

      const metadata: TydomMetaElement[] = endpoint.metadata;
      const firstUsage = configEndpoint.first_usage;
      const signature = getEndpointSignatureFromMetadata(metadata);
      const signatureHash = `${firstUsage}:${sha256Sync(signature)}`;

      // One row per distinct signature; the same hardware repeats across homes.
      const key = `${signatureHash}|${metadata.find((m) => m.name === "level")?.step ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const levelStep = metadata.find((m) => m.name === "level")?.step;
      fixtures.push({
        source: basename(file, ".json"),
        firstUsage,
        metadataNames: metadata.map((m) => m.name),
        ...(levelStep === undefined ? {} : { levelStep }),
        signature,
        signatureHash,
        expected: previous.get(signatureHash) ?? null,
      });
    }
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(fixtures, null, 2)}\n`);

const withExpectation = fixtures.filter((f) => f.expected).length;
console.log(
  `wrote ${fixtures.length} distinct endpoint signatures (${withExpectation} with expectations) to ${outFile}`,
);
