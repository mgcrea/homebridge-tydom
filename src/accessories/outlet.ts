import type {PlatformAccessory} from 'homebridge';
import {TydomAccessoryContext} from 'src/typings';
import {Service} from '../config/hap';
import TydomController from '../controller';
import {setupAccessoryIdentifyHandler, setupAccessoryInformationService} from '../helpers/accessory';
import {addAccessorySwitchableService, updateAccessorySwitchableService} from './services/switchableService';

export const setupOutlet = (accessory: PlatformAccessory<TydomAccessoryContext>, controller: TydomController): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  addAccessorySwitchableService(accessory, controller, Service.Outlet);
};

export const updateOutlet = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  updateAccessorySwitchableService(accessory, controller, updates, Service.Outlet);
};
