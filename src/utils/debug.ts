import createDebug from "debug";
import type { PlatformAccessory, Service } from "homebridge";
import { blue } from "kolorist";
import { Characteristic } from "src/config/hap";
import { chalkGet, chalkKeyword, chalkSet, chalkString, chalkUpd, chalkVal } from "./color";

type IdentifiableAccessoryObject = PlatformAccessory | Service;

export const debug = createDebug("homebridge-tydom");
export const enableDebug = () => {
  createDebug.enable("homebridge-tydom");
};

export const dir = (...args: unknown[]): void => {
  console.dir(args.length > 1 ? args : args[0], { colors: true, depth: 10 });
};

export const debugGet = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
): void => {
  debug(
    `${chalkGet("→GET")}:${blue(characteristic.name)} for accessory named=${chalkString(name)} with id=${chalkString(
      id,
    )} ...`,
  );
};

export const debugGetResult = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${chalkGet("←GET")}:${blue(characteristic.name)} value=${chalkVal(value as any)} for accessory named=${chalkString(
      name,
    )} with id=${chalkString(id)} ...`,
  );
};

export const debugSetUpdate = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${chalkUpd("←UPD")}:${blue(characteristic.name)} value=${chalkVal(value as any)} for accessory named=${chalkString(
      name,
    )} with id=${chalkString(id)}`,
  );
};

export const debugSet = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${chalkSet("→SET")}:${blue(characteristic.name)} value=${chalkVal(value as any)} for accessory named=${chalkString(
      name,
    )} with id=${chalkString(id)} ...`,
  );
};

export const debugSetResult = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
  tydomValue?: unknown,
): void => {
  debug(
    `${chalkSet("←SET")}:${blue(characteristic.name)} value=${chalkVal(value as any)}${
      tydomValue !== undefined ? ` (tydomValue=${chalkVal(tydomValue as any)})` : ""
    } for accessory named=${chalkString(name)} with id=${chalkString(id)}`,
  );
};

export const debugTydomPut = (
  property: string,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${chalkSet("→PUT")}:${blue(property)} value=${chalkVal(value)} for accessory named=${chalkString(
      name,
    )} with id=${chalkString(id)}`,
  );
};

export const debugAddSubService = (
  service: Service,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
): void => {
  debug(
    `Adding new sub service ${chalkKeyword(service.constructor.name)} with name=${chalkString(
      service.displayName,
    )}, subtype=${chalkString(service.subtype as any)} and id="${chalkString(service.UUID)}" for accessory named=${chalkString(
      name,
    )} with id=${chalkString(id)}`,
  );
};
