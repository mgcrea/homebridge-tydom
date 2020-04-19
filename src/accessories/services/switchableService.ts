import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {TydomEndpointData} from 'src/typings/tydom';
import {addAccessoryService} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import {debugGet, debugGetResult, debugSet, debugSetResult} from 'src/utils/debug';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/utils/tydom';

export const addAccessorySwitchableService = (
  accessory: PlatformAccessory,
  controller: TydomController,
  serviceClass: typeof Service
): Service => {
  const {displayName: name, UUID: id, context} = accessory;
  const {deviceId, endpointId} = context;
  const {client} = controller;

  const service = addAccessoryService(accessory, serviceClass, `${accessory.displayName}`, true);

  service
    .getCharacteristic(Characteristic.On)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('On', {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
        const level = getTydomDataPropValue<number>(data, 'level');
        const nextValue = level === 100;
        debugGetResult('CurrentTemperature', {name, id, value: nextValue});
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('On', {name, id, value});
      const nextValue = value ? 100 : 0;
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'level',
          value: nextValue
        }
      ]);
      debugSetResult('CurrentTemperature', {name, id, value: nextValue});
      callback(null, value);
    });

  return service;
};

export const updateAccessorySwitchableService = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[],
  serviceClass: typeof Service
): void => {
  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'level': {
        const service = accessory.getService(serviceClass);
        assert(service, `Unexpected missing service "${serviceClass} in accessory`);
        service.getCharacteristic(Characteristic.On)!.updateValue(value === 100);
        return;
      }
      default:
        return;
    }
  });
};
