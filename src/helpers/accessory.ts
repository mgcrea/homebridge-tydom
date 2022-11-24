import type {PlatformAccessory, Service, WithUUID} from 'homebridge';
import {setupSwitch, updateSwitch} from 'src/accessories/switch';
import {setupTriggerSwitch, updateTriggerSwitch} from 'src/accessories/triggerSwitch';
import {setupContactSensor, updateContactSensor} from '../accessories/contactSensor';
import {setupFan, updateFan} from '../accessories/fan';
import {setupGarageDoorOpener, updateGarageDoorOpener} from '../accessories/garageDoorOpener';
import {setupLightbulb, updateLightbulb} from '../accessories/lightbulb';
import {setupOutlet, updateOutlet} from '../accessories/outlet';
import {setupSecuritySystem, updateSecuritySystem} from '../accessories/securitySystem';
import {setupSecuritySystemSensors, updateSecuritySystemSensors} from '../accessories/securitySystemSensors';
import {setupTemperatureSensor, updateTemperatureSensor} from '../accessories/temperatureSensor';
import {setupThermostat, updateThermostat} from '../accessories/thermostat';
import {setupWindowCovering, updateWindowCovering} from '../accessories/windowCovering';
import {AccessoryEventTypes, Categories, Characteristic, Service as ServiceStatics} from '../config/hap';
import TydomController from '../controller';
import {TydomAccessoryContext} from '../typings/tydom';
import {assert, debug} from '../utils';

export const SECURITY_SYSTEM_SENSORS = parseInt(`${Categories.SECURITY_SYSTEM}0`);

export type ServiceClass = WithUUID<typeof Service>;

export const getAccessoryService = (accessory: PlatformAccessory, ServiceClass: ServiceClass): Service => {
  const service = accessory.getService(ServiceClass);
  assert(service, `Unexpected missing service "${ServiceClass.name}" in accessory`);
  return service;
};

export const getAccessoryServiceWithSubtype = (
  accessory: PlatformAccessory,
  ServiceClass: ServiceClass,
  subtype: string
): Service => {
  const service = accessory.getServiceByUUIDAndSubType(ServiceClass, subtype);
  assert(service, `Unexpected missing service "${ServiceClass.name}" with subtype="${subtype}" in accessory`);
  return service;
};

export const addAccessoryService = (
  accessory: PlatformAccessory,
  service: ServiceClass,
  name: string,
  removeExisting = false
): Service => {
  const existingService = accessory.getService(service);
  if (existingService) {
    if (!removeExisting) {
      return existingService;
    }
    accessory.removeService(existingService);
  }
  return accessory.addService(service, name);
};

export const addAccessoryServiceWithSubtype = (
  accessory: PlatformAccessory,
  service: ServiceClass,
  name: string,
  subtype: string,
  removeExisting = false
): Service => {
  const existingService = accessory.getServiceById(service, subtype);
  if (existingService) {
    if (!removeExisting) {
      return existingService;
    }
    accessory.removeService(existingService);
  }
  return accessory.addService(service, name, subtype);
};

type TydomAccessorySetup<T extends TydomAccessoryContext> = (
  accessory: PlatformAccessory<T>,
  controller: TydomController
) => void | Promise<void>;

export const getTydomAccessorySetup = <T extends TydomAccessoryContext<any, any> = TydomAccessoryContext>(
  accessory: PlatformAccessory<T>,
  context: T
): TydomAccessorySetup<T> => {
  const {category} = accessory;
  switch (category) {
    case Categories.LIGHTBULB:
      return setupLightbulb;
    case Categories.OUTLET:
      return setupOutlet;
    case Categories.THERMOSTAT:
      return setupThermostat;
    case Categories.FAN:
      return setupFan;
    case Categories.GARAGE_DOOR_OPENER:
      return setupGarageDoorOpener;
    case Categories.SWITCH:
      return context.settings?.trigger ? setupSwitch : setupTriggerSwitch;
    case Categories.WINDOW_COVERING:
      return setupWindowCovering;
    case Categories.SECURITY_SYSTEM:
      return setupSecuritySystem;
    case Categories.SENSOR:
      return setupTemperatureSensor;
    case Categories.WINDOW:
    case Categories.DOOR:
      return setupContactSensor;
    case SECURITY_SYSTEM_SENSORS:
      return setupSecuritySystemSensors;
    default:
      throw new Error(`Unsupported accessory category=${category}`);
  }
};

export type TydomAccessoryUpdateType = 'data' | 'cdata';

type TydomAccessoryUpdate<T extends TydomAccessoryContext> = (
  accessory: PlatformAccessory<T>,
  controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomAccessoryUpdateType
) => void | Promise<void>;

export const getTydomAccessoryDataUpdate = <T extends TydomAccessoryContext<any, any> = TydomAccessoryContext>(
  accessory: PlatformAccessory<T>,
  context: T
): TydomAccessoryUpdate<T> => {
  const {category} = accessory;
  switch (category) {
    case Categories.LIGHTBULB:
      return updateLightbulb;
    case Categories.OUTLET:
      return updateOutlet;
    case Categories.THERMOSTAT:
      return updateThermostat;
    case Categories.FAN:
      return updateFan;
    case Categories.GARAGE_DOOR_OPENER:
      return updateGarageDoorOpener;
    case Categories.SWITCH:
      return context.settings?.trigger ? updateSwitch : updateTriggerSwitch;
    case Categories.WINDOW_COVERING:
      return updateWindowCovering;
    case Categories.SECURITY_SYSTEM:
      return updateSecuritySystem;
    case Categories.SENSOR:
      return updateTemperatureSensor;
    case Categories.WINDOW:
    case Categories.DOOR:
      return updateContactSensor;
    case SECURITY_SYSTEM_SENSORS:
      return updateSecuritySystemSensors;
    default:
      throw new Error(`Unsupported accessory category=${category}`);
  }
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const setupAccessoryInformationService = (accessory: PlatformAccessory, _controller: TydomController): void => {
  const {context} = accessory;
  const {manufacturer = 'Delta Dore', serialNumber = 'N/A', model = 'N/A'} = context as TydomAccessoryContext;

  const informationService = accessory.getService(ServiceStatics.AccessoryInformation);
  assert(informationService, `Did not found AccessoryInformation service`);
  informationService
    .setCharacteristic(Characteristic.Manufacturer, manufacturer)
    .setCharacteristic(Characteristic.SerialNumber, serialNumber)
    .setCharacteristic(Characteristic.Model, model);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const setupAccessoryIdentifyHandler = (accessory: PlatformAccessory, _controller: TydomController): void => {
  const {displayName: name, UUID: id} = accessory;
  // listen for the "identify" event for this Accessory
  accessory.on(AccessoryEventTypes.IDENTIFY, (/* paired: boolean, callback: VoidCallback */) => {
    // debug({id, type: 'AccessoryEventTypes.IDENTIFY', paired});
    debug(`New identify request for device named="${name}" with id="${id}"`);
    // callback();
  });
};

export const assignTydomContext = (
  prev: PlatformAccessory['context'],
  next: TydomAccessoryContext
): prev is TydomAccessoryContext => {
  Object.assign(prev, next);
  return true;
};
