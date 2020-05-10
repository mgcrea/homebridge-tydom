import {Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service} from 'homebridge';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {TydomEndpointData} from 'src/typings/tydom';
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import {debugGet, debugGetResult, debugSetUpdate} from 'src/utils/debug';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/utils/tydom';

const {CurrentTemperature} = Characteristic;

export const setupTemperatureSensor = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.TemperatureSensor, `${accessory.displayName}`, true);

  service
    .getCharacteristic(CurrentTemperature)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(CurrentTemperature, service);
      try {
        const data = await getTydomDeviceData<TydomEndpointData>(client, {deviceId, endpointId});
        const outTemperature = getTydomDataPropValue<number>(data, 'outTemperature');
        debugGetResult(CurrentTemperature, service, outTemperature);
        callback(null, outTemperature);
      } catch (err) {
        callback(err);
      }
    });
};

export const updateTemperatureSensor = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[]
) => {
  const {CurrentTemperature} = Characteristic;
  updates.forEach((update) => {
    const {name, value} = update;
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
