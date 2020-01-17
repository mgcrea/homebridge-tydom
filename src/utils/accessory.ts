import {
  Categories,
  Service,
  Characteristic,
  AccessoryEventTypes,
  VoidCallback,
  CharacteristicEventTypes,
  CharacteristicValue,
  CharacteristicSetCallback,
  NodeCallback
} from 'hap-nodejs';
import setupGarageDoorOpener from 'src/accessories/garageDoorOpener';
import setupLightbulb from 'src/accessories/lightbulb';
import setupThermostat from 'src/accessories/thermostat';
import TydomController, {TydomAccessoryContext} from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import debug from 'src/utils/debug';
import {assert} from './assert';
import {TydomEndpointData} from 'src/typings/tydom';
import {getTydomDeviceData} from './tydom';

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
    case Categories.GARAGE_DOOR_OPENER:
      return setupGarageDoorOpener;
    default:
      throw new Error(`Unsupported accessory category=${category}`);
      break;
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

export const addAccessorySwitchableService = (
  accessory: PlatformAccessory,
  controller: TydomController,
  serviceClass: typeof Service
): Service => {
  const {displayName: name, UUID: id, context} = accessory;
  const {deviceId, endpointId} = context as TydomAccessoryContext;
  const {client} = controller;

  const service = addAccessoryService(accessory, serviceClass, `${accessory.displayName}`, true);

  service
    .getCharacteristic(Characteristic.On)!
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debug(`Setting device named="${name}" with id="${id}" value="${value}" ...`);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'level',
          value: value ? 100 : 0
        }
      ]);
      debug(`Sucessfully set device named="${name}" with id="${id}" value="${value}" ...`);
      callback();
    });

  service
    .getCharacteristic(Characteristic.On)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debug(`Getting device named="${name}" with id="${id}" value ...`);
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
        const level = data.find(prop => prop.name === 'level');
        assert(level, 'Missing `level` data item');
        const nextValue = level!.value === 100;
        debug(`Sucessfully got device named="${name}" with id="${id}" value="${nextValue}"`);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    });

  return service;
};

export const assignTydomContext = (
  prev: PlatformAccessory['context'],
  next: TydomAccessoryContext
): prev is TydomAccessoryContext => {
  Object.assign(prev, next);
  return true;
};
