#! /usr/bin/env node
import {readFileSync} from 'fs';
import {TydomConfigResponse, TydomMetaResponse} from '../typings';
import {getEndpointSignatureFromMetadata} from '../helpers/tydom';
import {sha256, sha256Sync} from '../utils';

const [action = 'help', ..._args] = process.argv.slice(2);

console.dir({action});
const main = async () => {
  switch (action) {
    case 'dump': {
      const stdin = readFileSync(process.stdin.fd);
      const dump = JSON.parse(stdin.toString('utf8'));
      const allDevicesConfig = dump['/configs/file'] as TydomConfigResponse;
      const allDevicesMeta = dump['/devices/meta'] as TydomMetaResponse;
      for (const deviceMeta of allDevicesMeta) {
        const signature = getEndpointSignatureFromMetadata(deviceMeta.endpoints[0].metadata);
        const config = allDevicesConfig.endpoints.find((item) => item.id_device === deviceMeta.id);
        const hash = `${config?.first_usage}:${await sha256(signature)}`;
        console.dir({name: config?.name, signature, hash});
      }
      break;
    }
    case 'hash': {
      const stdin = readFileSync(process.stdin.fd);
      const meta = JSON.parse(stdin.toString('utf8'));
      const metaSignature = getEndpointSignatureFromMetadata(meta);
      const hash = sha256Sync(metaSignature);
      console.dir({metaSignature, hash});
      break;
    }
    default:
      console.log('Sorry, that is not something I know how to do.');
  }
  process.exit(0);
};

main();
