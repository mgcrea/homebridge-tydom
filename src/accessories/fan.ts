import {Service, Characteristic} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {
  addAccessorySwitchableService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
  updateAccessorySwitchableService
} from 'src/utils/accessory';
import debug from 'src/utils/debug';

export const setupFan = (accessory: PlatformAccessory, controller: TydomController): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  addAccessorySwitchableService(accessory, controller, Service.Fan);
};

export const updateFan = (accessory: PlatformAccessory, updates: Record<string, unknown>[]) => {
  updateAccessorySwitchableService(accessory, updates, Service.Fan);
};
