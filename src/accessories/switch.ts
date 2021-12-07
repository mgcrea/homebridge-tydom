import type {PlatformAccessory} from 'homebridge';
import {Service} from '../config/hap';
import TydomController from '../controller';
import {setupAccessoryIdentifyHandler, setupAccessoryInformationService} from '../helpers/accessory';
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
