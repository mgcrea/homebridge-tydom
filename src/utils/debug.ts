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
    `${chalkGet("←GET")}:${blue(characteristic.name)} value=${chalkVal(String(value))} for accessory named=${chalkString(
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
    `${chalkUpd("←UPD")}:${blue(characteristic.name)} value=${chalkVal(String(value))} for accessory named=${chalkString(
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
    `${chalkSet("→SET")}:${blue(characteristic.name)} value=${chalkVal(String(value))} for accessory named=${chalkString(
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
  const valStr =
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value as string | number | boolean | null | undefined);

  const tydomValStr =
    tydomValue !== undefined
      ? typeof tydomValue === "object"
        ? JSON.stringify(tydomValue)
        : String(tydomValue as string | number | boolean | null | undefined)
      : undefined;

  debug(
    `${chalkSet("←SET")}:${blue(characteristic.name)} value=${chalkVal(valStr)}${
      tydomValStr !== undefined ? ` (tydomValue=${chalkVal(tydomValStr)})` : ""
    } for accessory named=${chalkString(name)} with id=${chalkString(id)}`,
  );
};

export const debugTydomPut = (
  property: string,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${chalkSet("→PUT")}:${blue(property)} value=${chalkVal(String(value))} for accessory named=${chalkString( // Fixed line
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
    )}, subtype=${chalkString(String(service.subtype))} and id="${chalkString( // Fixed line
      service.UUID,
    )}" for accessory named=${chalkString(name)} with id=${chalkString(id)}`,
  );
};
