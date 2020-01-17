import {Service} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {
  addAccessorySwitchableService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
  updateAccessorySwitchableService
} from 'src/utils/accessory';

export const setupLightbulb = (accessory: PlatformAccessory, controller: TydomController): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  addAccessorySwitchableService(accessory, controller, Service.Lightbulb);
};

export const updateLightbulb = (accessory: PlatformAccessory, updates: Record<string, unknown>[]) => {
  updateAccessorySwitchableService(accessory, updates, Service.Lightbulb);
};
