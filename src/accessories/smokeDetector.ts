import type {PlatformAccessory} from 'homebridge';
import {Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service} from '../config/hap';
import TydomController from '../controller';
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from '../helpers/accessory';
import {getTydomDataPropValue, getTydomDeviceData} from '../helpers/tydom';
import type {TydomAccessoryContext, TydomDeviceSmokeDetectorData} from '../typings/tydom';
import {debugGet, debugGetResult, debugSetUpdate} from '../utils/debug';
import {Formats} from 'homebridge';

export const setupSmokeDetector = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController
): void => {
  const {context} = accessory;
  const {client} = controller;
  const {SmokeDetected, StatusLowBattery} = Characteristic;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.SmokeSensor, `${accessory.displayName}`, true);

  service
    .getCharacteristic(SmokeDetected)
    .setProps({
      format: Formats.BOOL
    })
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(SmokeDetected, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceSmokeDetectorData>(client, {deviceId, endpointId});
        const smokeDefect = getTydomDataPropValue<boolean>(data, 'techSmokeDefect');
        debugGetResult(SmokeDetected, service, smokeDefect);
        callback(null, smokeDefect);
      } catch (err) {
        callback(err as Error);
      }
    });

  service
    .getCharacteristic(StatusLowBattery)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(StatusLowBattery, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceSmokeDetectorData>(client, {deviceId, endpointId});
        const battDefect = getTydomDataPropValue<boolean>(data, 'battDefect');
        debugGetResult(StatusLowBattery, service, battDefect);
        callback(null, battDefect ? StatusLowBattery.BATTERY_LEVEL_LOW : StatusLowBattery.BATTERY_LEVEL_NORMAL);
      } catch (err) {
        callback(err as Error);
      }
    });
};

export const updateSmokeDetector = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  updates.forEach((update) => {
    const {name, value} = update;
    const {SmokeDetected, StatusLowBattery} = Characteristic;
    switch (name) {
      case 'techSmokeDefect': {
        const service = getAccessoryService(accessory, Service.SmokeSensor);
        debugSetUpdate(SmokeDetected, service, value);
        service.updateCharacteristic(SmokeDetected, value as boolean);
        return;
      }
      case 'battDefect': {
        const service = getAccessoryService(accessory, Service.SmokeSensor);
        debugSetUpdate(StatusLowBattery, service, value);
        service.updateCharacteristic(StatusLowBattery, value as number);
        return;
      }
      default:
        return;
    }
  });
};
