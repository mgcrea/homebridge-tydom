import type {PlatformAccessory} from 'homebridge';
import {Service} from 'src/config/hap';
import TydomController from 'src/controller';
import {setupAccessoryIdentifyHandler, setupAccessoryInformationService} from 'src/helpers';
import {TydomAccessoryContext} from 'src/typings';
import {addAccessorySwitchableService, updateAccessorySwitchableService} from './services/switchableService';

export const setupSwitch = (accessory: PlatformAccessory<TydomAccessoryContext>, controller: TydomController): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  addAccessorySwitchableService(accessory, controller, Service.Switch);
};

export const updateSwitch = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  updateAccessorySwitchableService(accessory, controller, updates, Service.Switch);
};
