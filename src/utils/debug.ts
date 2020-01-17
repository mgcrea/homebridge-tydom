import console from 'console';
import createDebug from 'debug';
// @ts-ignore
import {name} from './../../package.json';

const debug = createDebug(name);

export default debug;

export const dir = (...args: unknown[]) => {
  console.dir(...args, {colors: true, depth: 10});
};
