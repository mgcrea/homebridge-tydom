import {Service} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {setupAccessoryIdentifyHandler, setupAccessoryInformationService} from 'src/utils/accessory';
import {addAccessorySwitchableService, updateAccessorySwitchableService} from './services/switchableService';

export const setupFan = (accessory: PlatformAccessory, controller: TydomController): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  addAccessorySwitchableService(accessory, controller, Service.Fan);
};

export const updateFan = (
  accessory: PlatformAccessory,
  controller: TydomController,
  updates: Record<string, unknown>[]
) => {
  updateAccessorySwitchableService(accessory, controller, updates, Service.Fan);
};
