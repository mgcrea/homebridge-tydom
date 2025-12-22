#! /usr/bin/env node
import { readFileSync } from "fs";
import { getEndpointSignatureFromMetadata } from "../helpers/tydom";
import { TydomConfigResponse, TydomMetaResponse } from "../typings";
import { sha256, sha256Sync } from "../utils";

const [action = "help", ...args] = process.argv.slice(2);
const [filename] = args;

console.dir({ action, args });
const main = async () => {
  switch (action) {
    case "dump": {
      const stdin = readFileSync(filename || process.stdin.fd);
      const dump = JSON.parse(stdin.toString("utf8"));
      const allDevicesConfig = dump["/configs/file"] as TydomConfigResponse;
      const allDevicesMeta = dump["/devices/meta"] as TydomMetaResponse;
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
      const meta = JSON.parse(stdin.toString("utf8"));
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

main();
