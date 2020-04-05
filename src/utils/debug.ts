import console from 'console';
import createDebug from 'debug';
// eslint-disable-next-line
// @ts-ignore
import {name} from './../../package.json';
import chalk from 'chalk';
import {chalkString} from './chalk.js';

export const debug = createDebug(name);

export default debug;

export const dir = (...args: unknown[]) => {
  console.dir(args.length > 1 ? args : args[0], {colors: true, depth: 10});
};

export const debugSet = (characteristic: string, {name, id, value}: {name: string; id: string; value: unknown}) => {
  debug(
    `${chalk.bold.red('→SET')}:${chalk.blue(characteristic)} value=${chalk.yellow(
      value
    )} for device named=${chalkString(name)} with id=${chalkString(id)} ...`
  );
};

export const debugSetResult = (
  characteristic: string,
  {name, id, value}: {name: string; id: string; value: unknown}
) => {
  debug(
    `${chalk.bold.red('←SET')}:${chalk.blue(characteristic)} value=${chalk.yellow(
      value
    )} for device named=${chalkString(name)} with id=${chalkString(id)}`
  );
};

export const debugGet = (characteristic: string, {name, id}: {name: string; id: string}) => {
  debug(
    `${chalk.bold.green('→GET')}:${chalk.blue(characteristic)} device named=${chalkString(name)} with id=${chalkString(
      id
    )} ...`
  );
};

export const debugGetResult = (
  characteristic: string,
  {name, id, value}: {name: string; id: string; value: unknown}
) => {
  debug(
    `${chalk.bold.green('←GET')}:${chalk.blue(characteristic)} value=${chalk.yellow(value)} device named=${chalkString(
      name
    )} with id=${chalkString(id)} ...`
  );
};
