import {Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {TydomEndpointData} from 'src/typings/tydom';
import {
  addAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import {debugGet, debugGetResult} from 'src/utils/debug';
import {getTydomDeviceData, getTydomDataPropValue} from 'src/utils/tydom';

export const setupTemperatureSensor = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {displayName: name, UUID: id, context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.TemperatureSensor, `${accessory.displayName}`, true);

  service
    .getCharacteristic(Characteristic.CurrentTemperature)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('CurrentTemperature', {name, id});
      try {
        const data = await getTydomDeviceData<TydomEndpointData>(client, {deviceId, endpointId});
        const outTemperature = getTydomDataPropValue<number>(data, 'outTemperature');
        debugGetResult('CurrentTemperature', {name, id, value: outTemperature});
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
    const {name} = update;
    switch (name) {
      case 'outTemperature': {
        const service = accessory.getService(Service.TemperatureSensor);
        assert(service, `Unexpected missing service "Service.TemperatureSensor" in accessory`);
        service.getCharacteristic(CurrentTemperature)!.updateValue(update!.value as number);
        return;
      }
      default:
        return;
    }
  });
};
