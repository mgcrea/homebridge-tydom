import {Service} from 'src/utils/hap';
import TydomController from 'src/controller';
import type {PlatformAccessory} from 'homebridge';
import {setupAccessoryIdentifyHandler, setupAccessoryInformationService} from 'src/utils/accessory';
import {addAccessorySwitchableService, updateAccessorySwitchableService} from './services/switchableService';

export const setupSwitch = (accessory: PlatformAccessory, controller: TydomController): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  addAccessorySwitchableService(accessory, controller, Service.Switch);
};

export const updateSwitch = (
  accessory: PlatformAccessory,
  controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  updateAccessorySwitchableService(accessory, controller, updates, Service.Switch);
};
