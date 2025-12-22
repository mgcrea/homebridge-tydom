import type { PlatformAccessory } from "homebridge";
import type { TydomAccessoryContext } from "src/typings";
import { Service } from "../config/hap";
import TydomController from "../controller";
import { setupAccessoryIdentifyHandler, setupAccessoryInformationService } from "../helpers/accessory";
import { addAccessorySwitchableService, updateAccessorySwitchableService } from "./services/switchableService";

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
