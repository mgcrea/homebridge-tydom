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
import debug, {debugGet, debugSet} from 'src/utils/debug';
import {getTydomDeviceData} from 'src/utils/tydom';

export const addAccessorySwitchableService = (
  accessory: PlatformAccessory,
  controller: TydomController,
  serviceClass: typeof Service
): Service => {
  const {displayName: name, UUID: id, context} = accessory;
  const {deviceId, endpointId} = context;
  const {client} = controller;

  const service = addAccessoryService(accessory, serviceClass, `${accessory.displayName}`, true);

  const serviceOnCharacteristic = service.getCharacteristic(Characteristic.On);
  assert(serviceOnCharacteristic);

  serviceOnCharacteristic.on(
    CharacteristicEventTypes.SET,
    async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('On', {name, id, value});
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'level',
          value: value ? 100 : 0
        }
      ]);
      debug(`Sucessfully set device named="${name}" with id="${id}" value="${value}" ...`);
      callback();
    }
  );

  serviceOnCharacteristic.on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
    debugGet('On', {name, id});
    try {
      const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
      const level = data.find(prop => prop.name === 'level');
      assert(level && level.value !== undefined, 'Missing `level.value` on data item');
      const nextValue = level.value === 100;
      debug(`Sucessfully got device named="${name}" with id="${id}" value="${nextValue}"`);
      callback(null, nextValue);
    } catch (err) {
      callback(err);
    }
  });

  return service;
};

export const updateAccessorySwitchableService = (
  accessory: PlatformAccessory,
  updates: Record<string, unknown>[],
  serviceClass: typeof Service
): void => {
  updates.forEach(update => {
    const {name, value} = update;
    switch (name) {
      case 'level': {
        const service = accessory.getService(serviceClass);
        assert(service, `Unexpected missing service "${serviceClass} in accessory`);
        const serviceOnCharacteristic = service.getCharacteristic(Characteristic.On);
        assert(serviceOnCharacteristic);
        serviceOnCharacteristic.updateValue(value === 100);
        return;
      }
      default:
        return;
    }
  });
};
