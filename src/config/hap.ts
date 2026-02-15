import type { HAP, API as Homebridge } from "homebridge";
export { AccessoryEventTypes, Categories } from "homebridge";
export type { CharacteristicProps, VoidCallback } from "homebridge";

export let Characteristic: HAP["Characteristic"];
export let Service: HAP["Service"];

export const defineHAPGlobals = (homebridge: Homebridge): void => {
  Characteristic = homebridge.hap.Characteristic;
  Service = homebridge.hap.Service;
};
