import console from 'console';
import createDebug from 'debug';
// eslint-disable-next-line
// @ts-ignore
import {name} from './../../package.json';
import chalk from 'chalk';
import {chalkString, chalkKeyword} from './chalk.js';
import {Characteristic, Service} from 'hap-nodejs';
import {PlatformAccessory} from 'src/typings/homebridge';

type IdentifiableAccessoryObject = PlatformAccessory | Service;

export const debug = createDebug(name);

export default debug;

export const dir = (...args: unknown[]) => {
  console.dir(args.length > 1 ? args : args[0], {colors: true, depth: 10});
};

export const debugGet = (
  characteristic: typeof Characteristic,
  {displayName: name, UUID: id}: IdentifiableAccessoryObject
) => {
  debug(
    `${chalk.bold.green('→GET')}:${chalk.blue(characteristic.name)} for accessory named=${chalkString(
      name
    )} with id=${chalkString(id)} ...`
  );
};

export const debugGetResult = (
  characteristic: typeof Characteristic,
  {displayName: name, UUID: id}: IdentifiableAccessoryObject,
  value: unknown
) => {
  debug(
    `${chalk.bold.green('←GET')}:${chalk.blue(characteristic.name)} value=${chalk.yellow(
      value
    )} for accessory named=${chalkString(name)} with id=${chalkString(id)} ...`
  );
};

export const debugSetUpdate = (
  characteristic: typeof Characteristic,
  {displayName: name, UUID: id}: IdentifiableAccessoryObject,
  value: unknown
) => {
  debug(
    `${chalk.bold.yellow('←UPD')}:${chalk.blue(characteristic.name)} value=${chalk.yellow(
      value
    )} for accessory named=${chalkString(name)} with id=${chalkString(id)}`
  );
};

export const debugSet = (
  characteristic: typeof Characteristic,
  {displayName: name, UUID: id}: IdentifiableAccessoryObject,
  value: unknown
) => {
  debug(
    `${chalk.bold.red('→SET')}:${chalk.blue(characteristic.name)} value=${chalk.yellow(
      value
    )} for accessory named=${chalkString(name)} with id=${chalkString(id)} ...`
  );
};

export const debugSetResult = (
  characteristic: typeof Characteristic,
  {displayName: name, UUID: id}: IdentifiableAccessoryObject,
  value: unknown,
  tydomValue?: unknown
) => {
  debug(
    `${chalk.bold.red('←SET')}:${chalk.blue(characteristic.name)} value=${chalk.yellow(value)}${
      tydomValue !== undefined ? ` (tydomValue=${chalk.yellow(tydomValue)})` : ''
    } for accessory named=${chalkString(name)} with id=${chalkString(id)}`
  );
};

export const debugTydomPut = (
  property: string,
  {displayName: name, UUID: id}: IdentifiableAccessoryObject,
  value: unknown
) => {
  debug(
    `${chalk.bold.red('→PUT')}:${chalk.blue(property)} value=${chalk.yellow(value)} for accessory named=${chalkString(
      name
    )} with id=${chalkString(id)}`
  );
};

export const debugAddSubService = (service: Service, {displayName: name, UUID: id}: IdentifiableAccessoryObject) => {
  debug(
    `Adding new sub service ${chalkKeyword(service.constructor.name)} with name=${chalkString(
      service.displayName
    )}, subtype=${chalkString(service.subtype)} and id="${chalkString(service.UUID)}" for accessory named=${chalkString(
      name
    )} with id=${chalkString(id)}`
  );
};
