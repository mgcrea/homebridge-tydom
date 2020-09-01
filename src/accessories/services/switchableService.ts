import type {PlatformAccessory, Service} from 'homebridge';
import TydomController from 'src/controller';
import type {TydomAccessoryContext, TydomEndpointData} from 'src/typings/tydom';
import {addAccessoryService, getAccessoryService, ServiceClass} from 'src/utils/accessory';
import {debugGet, debugGetResult, debugSet, debugSetResult, debugSetUpdate} from 'src/utils/debug';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback
} from 'src/utils/hap';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/utils/tydom';

const {On} = Characteristic;

export const addAccessorySwitchableService = (
  accessory: PlatformAccessory,
  controller: TydomController,
  serviceClass: ServiceClass
): Service => {
  const {context} = accessory;
  const {deviceId, endpointId} = context as TydomAccessoryContext;
  const {client} = controller;

  const service = addAccessoryService(accessory, serviceClass, `${accessory.displayName}`, true);

  service
    .getCharacteristic(On)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(On, service);
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
        const level = getTydomDataPropValue<number>(data, 'level');
        const nextValue = level === 100;
        debugGetResult(On, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(On, service, value);
      try {
        const tydomValue = value ? 100 : 0;
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
          {
            name: 'level',
            value: tydomValue
          }
        ]);
        debugSetResult(On, service, value, tydomValue);
        callback();
      } catch (err) {
        callback(err);
      }
    });

  return service;
};

export const updateAccessorySwitchableService = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[],
  ServiceClass: ServiceClass
): void => {
  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'level': {
        const service = getAccessoryService(accessory, ServiceClass);
        const nextValue = value === 100;
        debugSetUpdate(On, service, nextValue);
        service.updateCharacteristic(On, nextValue);
        return;
      }
      default:
        return;
    }
  });
};
