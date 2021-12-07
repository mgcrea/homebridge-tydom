import type {API as Homebridge, HAP} from 'homebridge';
export {AccessoryEventTypes, Categories, CharacteristicEventTypes} from 'homebridge';
export type {
  CharacteristicProps,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  VoidCallback
} from 'homebridge';

export let Characteristic: HAP['Characteristic'];
export let Service: HAP['Service'];

export const defineHAPGlobals = (homebridge: Homebridge): void => {
  Characteristic = homebridge.hap.Characteristic;
  Service = homebridge.hap.Service;
};
