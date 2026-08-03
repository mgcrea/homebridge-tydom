#! /usr/bin/env node
import { readFileSync } from "fs";
import { getEndpointSignatureFromMetadata } from "src/helpers/tydom";
import type { TydomConfigResponse, TydomMetaElement, TydomMetaResponse } from "src/typings";
import { sha256, sha256Sync } from "src/utils";

const [action, ...args] = process.argv.slice(2);
const [filename] = args;

type DumpFormat = {
  "/configs/file": TydomConfigResponse;
  "/devices/meta": TydomMetaResponse;
};

console.dir({ action, args });
const main = async () => {
  switch (action) {
    case "dump": {
      const stdin = readFileSync(filename || process.stdin.fd);
      const dump = JSON.parse(stdin.toString("utf8")) as DumpFormat;
      const allDevicesConfig = dump["/configs/file"];
      const allDevicesMeta = dump["/devices/meta"];
      for (const deviceMeta of allDevicesMeta) {
        for (const endpointMeta of deviceMeta.endpoints) {
          const signature = getEndpointSignatureFromMetadata(endpointMeta.metadata);
          const config = allDevicesConfig.endpoints.find(
            (item) => item.id_device === deviceMeta.id && item.id_endpoint === endpointMeta.id,
          );
          const hash = `${config?.first_usage}:${await sha256(signature)}`;
          console.dir({ id: `${deviceMeta.id}.${endpointMeta.id}`, name: config?.name, signature, hash });
        }
      }
      break;
    }
    case "hash": {
      const stdin = readFileSync(filename || process.stdin.fd);
      const meta = JSON.parse(stdin.toString("utf8")) as TydomMetaElement[];
      const metaSignature = getEndpointSignatureFromMetadata(meta);
      const hash = sha256Sync(metaSignature);
      console.dir({ metaSignature, hash });
      break;
    }
    default:
      console.log("Sorry, that is not something I know how to do.");
  }
  process.exit(0);
};

void main();
