import createDebug from "debug";
import type { PlatformAccessory, Service } from "homebridge";
import {
  styleGet,
  styleKeyword,
  styleSet,
  styleString,
  styleUpd,
  styleVal,
} from "../util/style.js";

type IdentifiableAccessoryObject = PlatformAccessory | Service;

/**
 * Enough of a HAP characteristic to name it in a trace line.
 *
 * Not `typeof Characteristic`, which is the entire statics namespace: a
 * concrete class such as `ContactSensorState` satisfies that only by inheriting
 * all 260-odd siblings through the prototype chain, so any characteristic
 * described generically — one held in a mapping table rather than named
 * literally — fails to type against it. These helpers read the name and nothing
 * else.
 */
type NamedCharacteristic = { name: string };

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
  characteristic: NamedCharacteristic,
  target: IdentifiableAccessoryObject,
): void => {
  debug(`${styleGet("→GET")}:${styleKeyword(characteristic.name)} for ${describe(target)} ...`);
};

export const debugGetResult = (
  characteristic: NamedCharacteristic,
  target: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleGet("←GET")}:${styleKeyword(characteristic.name)} value=${styleVal(value)} for ${describe(target)}`,
  );
};

export const debugSetUpdate = (
  characteristic: NamedCharacteristic,
  target: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleUpd("←UPD")}:${styleKeyword(characteristic.name)} value=${styleVal(value)} for ${describe(target)}`,
  );
};

export const debugSet = (
  characteristic: NamedCharacteristic,
  target: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleSet("→SET")}:${styleKeyword(characteristic.name)} value=${styleVal(value)} for ${describe(target)} ...`,
  );
};

export const debugSetResult = (
  characteristic: NamedCharacteristic,
  target: IdentifiableAccessoryObject,
  value: unknown,
  tydomValue?: unknown,
): void => {
  debug(
    `${styleSet("←SET")}:${styleKeyword(characteristic.name)} value=${styleVal(value)}${
      tydomValue !== undefined ? ` (tydomValue=${styleVal(tydomValue)})` : ""
    } for ${describe(target)}`,
  );
};

export const debugTydomPut = (
  property: string,
  target: IdentifiableAccessoryObject,
  value: unknown,
): void => {
  debug(
    `${styleSet("→PUT")}:${styleKeyword(property)} value=${styleVal(value)} for ${describe(target)}`,
  );
};

export const debugAddSubService = (service: Service, target: IdentifiableAccessoryObject): void => {
  debug(
    `Adding new sub service ${styleKeyword(service.constructor.name)} with name=${styleString(
      service.displayName,
    )} and subtype=${styleString(service.subtype)} for ${describe(target)}`,
  );
};
