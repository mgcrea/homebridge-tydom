import createDebug from "debug";
import type { Characteristic, PlatformAccessory, Service } from "homebridge";
import { blue } from "kolorist";
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

/**
 * How a trace line names the thing it is about.
 *
 * These helpers are handed a `Service` far more often than an accessory, and a
 * Service's `UUID` is its *type* — every Lightbulb in the house reports
 * `00000043-…`. Logging that as "id" made it impossible to tell seven lights
 * apart in a support log, which is the one job these lines have. So the display
 * name leads, and an id is printed only when it distinguishes anything: an
 * accessory's real UUID, or a sub-service's subtype.
 */
const describe = (target: IdentifiableAccessoryObject): string => {
  const name = styleString(target.displayName);
  if ("subtype" in target) {
    return target.subtype ? `${name} (${styleString(target.subtype)})` : name;
  }
  return `${name} (${styleString(target.UUID)})`;
};

export const debugGet = (
  characteristic: typeof Characteristic,
  target: IdentifiableAccessoryObject,
): void => {
  debug(`${styleGet("→GET")}:${blue(characteristic.name)} for ${describe(target)} ...`);
};

export const debugGetResult = (
  characteristic: typeof Characteristic,
  target: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleGet("←GET")}:${blue(characteristic.name)} value=${styleVal(value)} for ${describe(target)}`,
  );
};

export const debugSetUpdate = (
  characteristic: typeof Characteristic,
  target: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleUpd("←UPD")}:${blue(characteristic.name)} value=${styleVal(value)} for ${describe(target)}`,
  );
};

export const debugSet = (
  characteristic: typeof Characteristic,
  target: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleSet("→SET")}:${blue(characteristic.name)} value=${styleVal(value)} for ${describe(target)} ...`,
  );
};

export const debugSetResult = (
  characteristic: typeof Characteristic,
  target: IdentifiableAccessoryObject,
  value: unknown,
  tydomValue?: unknown,
): void => {
  debug(
    `${styleSet("←SET")}:${blue(characteristic.name)} value=${styleVal(value)}${
      tydomValue !== undefined ? ` (tydomValue=${styleVal(tydomValue)})` : ""
    } for ${describe(target)}`,
  );
};

export const debugTydomPut = (
  property: string,
  target: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(`${styleSet("→PUT")}:${blue(property)} value=${styleVal(value)} for ${describe(target)}`);
};

export const debugAddSubService = (service: Service, target: IdentifiableAccessoryObject): void => {
  debug(
    `Adding new sub service ${styleKeyword(service.constructor.name)} with name=${styleString(
      service.displayName,
    )} and subtype=${styleString(service.subtype)} for ${describe(target)}`,
  );
};
