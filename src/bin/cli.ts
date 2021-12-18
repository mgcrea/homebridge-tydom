#! /usr/bin/env node
import {readFileSync} from 'fs';
import {getEndpointSignatureFromMetadata} from '../helpers/tydom';
import {sha256Sync} from '../utils';

const [action = 'help', ..._args] = process.argv.slice(2);

console.dir({action});
const main = async () => {
  switch (action) {
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
