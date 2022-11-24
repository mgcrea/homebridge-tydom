import {
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  PlatformAccessory
} from 'homebridge';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/helpers/tydom';
import {TydomAccessoryContext} from 'src/typings';
import {debugGet, debugGetResult, debugSet, debugSetResult} from 'src/utils';
import {Characteristic, Service} from '../config/hap';
import TydomController from '../controller';
import {
  addAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from '../helpers/accessory';
import {updateAccessorySwitchableService} from './services/switchableService';

export const setupOutlet = (accessory: PlatformAccessory<TydomAccessoryContext>, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;
  const {On} = Characteristic;
  const {deviceId, endpointId} = context;

  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.Outlet, `${accessory.displayName}`, true);

  service
    .getCharacteristic(On)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(On, service);
      try {
        const data = await getTydomDeviceData(client, {deviceId, endpointId});
        const plugCmd = getTydomDataPropValue<string>(data, 'plugCmd');
        const nextValue = plugCmd === 'ON';
        debugGetResult(On, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(On, service, value);
      try {
        const tydomValue = value ? 'ON' : 'OFF';
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
          {
            name: 'plugCmd',
            value: tydomValue
          }
        ]);
        debugSetResult(On, service, value, tydomValue);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    });
};

export const updateOutlet = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  updateAccessorySwitchableService(accessory, controller, updates, Service.Outlet);
};
