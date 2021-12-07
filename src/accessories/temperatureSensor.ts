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
import type {TydomAccessoryContext, TydomEndpointData} from '../typings/tydom';
import {debugGet, debugGetResult, debugSetUpdate} from '../utils/debug';

export const setupTemperatureSensor = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;
  const {CurrentTemperature} = Characteristic;

  const {deviceId, endpointId} = context as TydomAccessoryContext;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.TemperatureSensor, `${accessory.displayName}`, true);

  service
    .getCharacteristic(CurrentTemperature)
    .setProps({
      minValue: -100
    })
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(CurrentTemperature, service);
      try {
        const data = await getTydomDeviceData<TydomEndpointData>(client, {deviceId, endpointId});
        const outTemperature = getTydomDataPropValue<number>(data, 'outTemperature');
        debugGetResult(CurrentTemperature, service, outTemperature);
        callback(null, outTemperature);
      } catch (err) {
        callback(err as Error);
      }
    });
};

export const updateTemperatureSensor = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  updates.forEach((update) => {
    const {name, value} = update;
    const {CurrentTemperature} = Characteristic;
    switch (name) {
      case 'outTemperature': {
        const service = getAccessoryService(accessory, Service.TemperatureSensor);
        debugSetUpdate(CurrentTemperature, service, value);
        service.updateCharacteristic(CurrentTemperature, value as number);
        return;
      }
      default:
        return;
    }
  });
};
