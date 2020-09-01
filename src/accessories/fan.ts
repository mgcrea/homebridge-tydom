import type {PlatformAccessory} from 'homebridge';
import TydomController from '../controller';
import {setupAccessoryIdentifyHandler, setupAccessoryInformationService} from '../utils/accessory';
import {Service} from '../utils/hap';
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
): void => {
  updateAccessorySwitchableService(accessory, controller, updates, Service.Fan);
};
