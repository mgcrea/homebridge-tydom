import createDebug from "debug";
import type { PlatformAccessory, Service } from "homebridge";
import { blue } from "kolorist";
import type { Characteristic } from "../config/hap.js";
import {
  styleGet,
  styleKeyword,
  styleSet,
  styleString,
  styleUpd,
  styleVal,
} from "../util/style.js";

type IdentifiableAccessoryObject = PlatformAccessory | Service;

export const debug = createDebug("homebridge-tydom");
export const enableDebug = () => {
  createDebug.enable("homebridge-tydom");
};

export const debugGet = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
): void => {
  debug(
    `${styleGet("→GET")}:${blue(characteristic.name)} for accessory named=${styleString(name)} with id=${styleString(
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
    `${styleGet("←GET")}:${blue(characteristic.name)} value=${styleVal(value)} for accessory named=${styleString(
      name,
    )} with id=${styleString(id)} ...`,
  );
};

export const debugSetUpdate = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleUpd("←UPD")}:${blue(characteristic.name)} value=${styleVal(value)} for accessory named=${styleString(
      name,
    )} with id=${styleString(id)}`,
  );
};

export const debugSet = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleSet("→SET")}:${blue(characteristic.name)} value=${styleVal(value)} for accessory named=${styleString(
      name,
    )} with id=${styleString(id)} ...`,
  );
};

export const debugSetResult = (
  characteristic: typeof Characteristic,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
  tydomValue?: unknown,
): void => {
  debug(
    `${styleSet("←SET")}:${blue(characteristic.name)} value=${styleVal(value)}${
      tydomValue !== undefined ? ` (tydomValue=${styleVal(tydomValue)})` : ""
    } for accessory named=${styleString(name)} with id=${styleString(id)}`,
  );
};

export const debugTydomPut = (
  property: string,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleSet("→PUT")}:${blue(property)} value=${styleVal(value)} for accessory named=${styleString(
      name,
    )} with id=${styleString(id)}`,
  );
};

export const debugAddSubService = (
  service: Service,
  { displayName: name, UUID: id }: IdentifiableAccessoryObject,
): void => {
  debug(
    `Adding new sub service ${styleKeyword(service.constructor.name)} with name=${styleString(
      service.displayName,
    )}, subtype=${styleString(service.subtype)} and id="${styleString(service.UUID)}" for accessory named=${styleString(
      name,
    )} with id=${styleString(id)}`,
  );
};
