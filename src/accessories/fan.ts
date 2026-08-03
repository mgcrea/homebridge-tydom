import type { PlatformAccessory } from "homebridge";
import { Service } from "../config/hap.js";
import type TydomController from "../controller.js";
import {
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "../helpers/accessory.js";
import type { TydomAccessoryContext } from "../typings/tydom.js";
import {
  addAccessorySwitchableService,
  updateAccessorySwitchableService,
} from "./services/switchableService.js";

export const setupFan = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  addAccessorySwitchableService(accessory, controller, Service.Fan);
};

export const updateFan = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
  updates: Record<string, unknown>[],
): void => {
  updateAccessorySwitchableService(accessory, controller, updates, Service.Fan);
};
