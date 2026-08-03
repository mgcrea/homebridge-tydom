import type { PlatformAccessory, Service, WithUUID } from "homebridge";
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

/** Whether an update carried device data or the result of a device command. */
export type TydomAccessoryUpdateType = "data" | "cdata";

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
