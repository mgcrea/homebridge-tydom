import type { PlatformAccessory, Service, WithUUID } from "homebridge";
import { setupContactSensor, updateContactSensor } from "../accessories/contactSensor.js";
import { setupFan, updateFan } from "../accessories/fan.js";
import { setupGarageDoorOpener, updateGarageDoorOpener } from "../accessories/garageDoorOpener.js";
import { setupLightbulb, updateLightbulb } from "../accessories/lightbulb.js";
import { setupOutlet, updateOutlet } from "../accessories/outlet.js";
import { setupSecuritySystem, updateSecuritySystem } from "../accessories/securitySystem.js";
import {
  setupSecuritySystemSensors,
  updateSecuritySystemSensors,
} from "../accessories/securitySystemSensors.js";
import { setupSmokeDetector, updateSmokeDetector } from "../accessories/smokeDetector.js";
import { setupSwitch, updateSwitch } from "../accessories/switch.js";
import {
  setupTemperatureSensor,
  updateTemperatureSensor,
} from "../accessories/temperatureSensor.js";
import { setupThermostat, updateThermostat } from "../accessories/thermostat.js";
import { setupTriggerSwitch, updateTriggerSwitch } from "../accessories/triggerSwitch.js";
import { setupWindowCovering, updateWindowCovering } from "../accessories/windowCovering.js";
import type { Categories } from "homebridge";
import { CATEGORY } from "../api/device-type.js";
import { Characteristic, Service as ServiceStatics } from "../config/hap.js";
import type TydomController from "../controller.js";
import type { TydomAccessoryContext } from "../typings/tydom.js";
import { assert } from "../util/assert.js";
import { debug } from "../platform/trace.js";

/**
 * Synthetic companion category — 110, not a real HAP category. See
 * CATEGORY.ALARM_SENSORS for why the number is frozen.
 *
 * The cast is needed because it is not a member of HAP's `Categories` enum, yet
 * it is stored in fields typed as one. Phase 5 stops using categories as the
 * dispatch key, which removes the need for it.
 */
export const SECURITY_SYSTEM_SENSORS = CATEGORY.ALARM_SENSORS as unknown as Categories;

export type ServiceClass = WithUUID<typeof Service>;

export const getAccessoryService = (
  accessory: PlatformAccessory,
  ServiceClass: ServiceClass,
): Service => {
  const service = accessory.getService(ServiceClass);
  assert(service, `Unexpected missing service "${ServiceClass.name}" in accessory`);
  return service;
};

export const getAccessoryServiceWithSubtype = (
  accessory: PlatformAccessory,
  ServiceClass: ServiceClass,
  subtype: string,
): Service => {
  const service = accessory.getServiceById(ServiceClass, subtype);
  assert(
    service,
    `Unexpected missing service "${ServiceClass.name}" with subtype="${subtype}" in accessory`,
  );
  return service;
};

export const addAccessoryService = (
  accessory: PlatformAccessory,
  service: ServiceClass,
  name: string,
  removeExisting = false,
): Service => {
  const existingService = accessory.getService(service);
  if (existingService) {
    if (!removeExisting) {
      return existingService;
    }
    accessory.removeService(existingService);
  }
  // oxlint-disable-next-line typescript/no-explicit-any
  return accessory.addService(service as any, name);
};

export const addAccessoryServiceWithSubtype = (
  accessory: PlatformAccessory,
  service: ServiceClass,
  name: string,
  subtype: string,
  removeExisting = false,
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
  controller: TydomController,
) => void | Promise<void>;

/**
 * Resolve the setup function for an accessory.
 *
 * The `any` generics make this dispatch deliberately unsound: every accessory
 * module declares its own settings/state shape, and there is no way to say
 * "returns the function matching this category" from here. Phase 5 replaces the
 * whole thing with an exhaustive `Record<DeviceType, AccessoryFactory>`, which
 * lets the compiler check the mapping instead.
 */
export const getTydomAccessorySetup = <
  // oxlint-disable-next-line typescript/no-explicit-any
  T extends TydomAccessoryContext<any, any> = TydomAccessoryContext,
>(
  accessory: PlatformAccessory<T>,
  context: T,
): TydomAccessorySetup<T> => {
  const { category } = accessory;
  const settings = context.settings as Record<string, unknown>;
  // Custom category for security system sensors
  if (category === (SECURITY_SYSTEM_SENSORS as Categories)) {
    return setupSecuritySystemSensors;
  }
  switch (category) {
    case CATEGORY.LIGHTBULB:
      return setupLightbulb;
    case CATEGORY.OUTLET:
      return setupOutlet;
    case CATEGORY.THERMOSTAT:
      return setupThermostat;
    case CATEGORY.FAN:
      return setupFan;
    case CATEGORY.GARAGE_DOOR_OPENER:
      return setupGarageDoorOpener;
    case CATEGORY.SWITCH:
      return settings.trigger ? setupTriggerSwitch : setupSwitch;
    case CATEGORY.WINDOW_COVERING:
      return setupWindowCovering;
    case CATEGORY.SECURITY_SYSTEM:
      return setupSecuritySystem;
    case CATEGORY.SENSOR:
      return settings.smokeDetector ? setupSmokeDetector : setupTemperatureSensor;
    case CATEGORY.WINDOW:
    case CATEGORY.DOOR:
      return setupContactSensor;
    default:
      throw new Error(`Unsupported accessory category=${category}`);
  }
};

export type TydomAccessoryUpdateType = "data" | "cdata";

type TydomAccessoryUpdate<T extends TydomAccessoryContext> = (
  accessory: PlatformAccessory<T>,
  controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomAccessoryUpdateType,
) => void | Promise<void>;

/** Resolve the push-update handler for an accessory. See {@link getTydomAccessorySetup}. */
export const getTydomAccessoryDataUpdate = <
  // oxlint-disable-next-line typescript/no-explicit-any
  T extends TydomAccessoryContext<any, any> = TydomAccessoryContext,
>(
  accessory: PlatformAccessory<T>,
  context: T,
): TydomAccessoryUpdate<T> => {
  const { category } = accessory;
  const settings = context.settings as Record<string, unknown>;
  // Custom category for security system sensors
  if (category === (SECURITY_SYSTEM_SENSORS as Categories)) {
    return updateSecuritySystemSensors;
  }
  switch (category) {
    case CATEGORY.LIGHTBULB:
      return updateLightbulb;
    case CATEGORY.OUTLET:
      return updateOutlet;
    case CATEGORY.THERMOSTAT:
      return updateThermostat;
    case CATEGORY.FAN:
      return updateFan;
    case CATEGORY.GARAGE_DOOR_OPENER:
      return updateGarageDoorOpener;
    case CATEGORY.SWITCH:
      return settings.trigger ? updateTriggerSwitch : updateSwitch;
    case CATEGORY.WINDOW_COVERING:
      return updateWindowCovering;
    case CATEGORY.SECURITY_SYSTEM:
      return updateSecuritySystem;
    case CATEGORY.SENSOR:
      return settings.smokeDetector ? updateSmokeDetector : updateTemperatureSensor;
    case CATEGORY.WINDOW:
    case CATEGORY.DOOR:
      return updateContactSensor;
    default:
      throw new Error(`Unsupported accessory category=${category}`);
  }
};

export const setupAccessoryInformationService = (
  accessory: PlatformAccessory,
  _controller: TydomController,
): void => {
  const { context } = accessory;
  const {
    manufacturer = "Delta Dore",
    serialNumber = "N/A",
    model = "N/A",
  } = context as TydomAccessoryContext;

  const informationService = accessory.getService(ServiceStatics.AccessoryInformation);
  assert(informationService, `Did not found AccessoryInformation service`);
  informationService
    .setCharacteristic(Characteristic.Manufacturer, manufacturer)
    .setCharacteristic(Characteristic.SerialNumber, serialNumber)
    .setCharacteristic(Characteristic.Model, model);
};

export const setupAccessoryIdentifyHandler = (
  accessory: PlatformAccessory,
  _controller: TydomController,
): void => {
  const { displayName: name, UUID: id } = accessory;
  // listen for the "identify" event for this Accessory
  accessory.on("identify", (/* paired: boolean, callback: VoidCallback */) => {
    // debug({id, type: 'AccessoryEventTypes.IDENTIFY', paired});
    debug(`New identify request for device named="${name}" with id="${id}"`);
    // callback();
  });
};

export const assignTydomContext = (
  prev: PlatformAccessory["context"],
  next: TydomAccessoryContext,
): prev is TydomAccessoryContext => {
  Object.assign(prev, next);
  return true;
};
