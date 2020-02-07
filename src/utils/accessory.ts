import {AccessoryEventTypes, Categories, Characteristic, Service, VoidCallback} from 'hap-nodejs';
import {setupFan, updateFan} from 'src/accessories/fan';
import {setupGarageDoorOpener} from 'src/accessories/garageDoorOpener';
import {setupLightbulb, updateLightbulb} from 'src/accessories/lightbulb';
import {setupThermostat, updateThermostat} from 'src/accessories/thermostat';
import TydomController, {TydomAccessoryContext} from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import assert from 'src/utils/assert';
import debug from 'src/utils/debug';

export const addAccessoryService = (
  accessory: PlatformAccessory,
  service: Service | typeof Service,
  name: string,
  removeExisting: boolean = false
) => {
  const existingService = accessory.getService(service);
  if (existingService) {
    if (!removeExisting) {
      return existingService;
    }
    accessory.removeService(existingService);
  }
  return accessory.addService(service, name);
};

type TydomAccessorySetup = (accessory: PlatformAccessory, controller: TydomController) => void;

export const getTydomAccessorySetup = (accessory: PlatformAccessory): TydomAccessorySetup => {
  const {category} = accessory;
  switch (category) {
    case Categories.LIGHTBULB:
      return setupLightbulb;
    case Categories.THERMOSTAT:
      return setupThermostat;
    case Categories.FAN:
      return setupFan;
    case Categories.GARAGE_DOOR_OPENER:
      return setupGarageDoorOpener;
    default:
      throw new Error(`Unsupported accessory category=${category}`);
  }
};

type TydomAccessoryUpdate = (accessory: PlatformAccessory, update: Record<string, unknown>[]) => void;

export const getTydomAccessoryUpdate = (accessory: PlatformAccessory): TydomAccessoryUpdate => {
  const {category} = accessory;
  switch (category) {
    case Categories.LIGHTBULB:
      return updateLightbulb;
    case Categories.THERMOSTAT:
      return updateThermostat;
    case Categories.FAN:
      return updateFan;
    case Categories.GARAGE_DOOR_OPENER:
      return () => {
        // no-op
      };
    default:
      throw new Error(`Unsupported accessory category=${category}`);
  }
};

export const setupAccessoryInformationService = (accessory: PlatformAccessory, _controller: TydomController): void => {
  const {context} = accessory;
  const {manufacturer, serialNumber, model} = context as TydomAccessoryContext;

  const informationService = accessory.getService(Service.AccessoryInformation);
  assert(informationService, `Did not found AccessoryInformation service`);
  informationService
    .setCharacteristic(Characteristic.Manufacturer, manufacturer)
    .setCharacteristic(Characteristic.SerialNumber, serialNumber)
    .setCharacteristic(Characteristic.Model, model);
};

export const setupAccessoryIdentifyHandler = (accessory: PlatformAccessory, _controller: TydomController): void => {
  const {displayName: name, UUID: id} = accessory;
  // listen for the "identify" event for this Accessory
  accessory.on(AccessoryEventTypes.IDENTIFY, async (paired: boolean, callback: VoidCallback) => {
    debug({id, type: 'AccessoryEventTypes.IDENTIFY', paired});
    debug(`New identify request for device named="${name}" with id="${id}"`);
    callback();
  });
};

export const assignTydomContext = (
  prev: PlatformAccessory['context'],
  next: TydomAccessoryContext
): prev is TydomAccessoryContext => {
  Object.assign(prev, next);
  return true;
};
