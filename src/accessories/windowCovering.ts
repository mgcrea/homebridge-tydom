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
import {TydomDeviceShutterData} from 'src/typings/tydom';
import {
  addAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import {debugGet, debugGetResult, debugSet, debugSetResult} from 'src/utils/debug';
import {getTydomDeviceData, getTydomDataPropValue} from 'src/utils/tydom';

export const setupWindowCovering = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {displayName: name, UUID: id, context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.WindowCovering, `${accessory.displayName}`, true);
  const {TargetPosition, CurrentPosition} = Characteristic;

  (service.getCharacteristic(CurrentPosition) as Characteristic).on(
    CharacteristicEventTypes.GET,
    async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('CurrentPosition', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceShutterData>(client, {deviceId, endpointId});
        const nextValue = getTydomDataPropValue<number>(data, 'position');
        debugGetResult('CurrentPosition', {name, id, value: nextValue});
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    }
  );

  (service.getCharacteristic(TargetPosition) as Characteristic)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('TargetPosition', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceShutterData>(client, {deviceId, endpointId});
        const nextValue = getTydomDataPropValue<number>(data, 'position');
        debugGetResult('TargetPosition', {name, id, value: nextValue});
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('TargetPosition', {name, id, value});
      const nextValue = Math.round(value as number);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'position',
          value: nextValue
        }
      ]);
      debugSetResult('TargetPosition', {name, id, value: nextValue});
      callback();
    });
};

export const updateWindowCovering = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[]
) => {
  const {CurrentPosition} = Characteristic;
  updates.forEach((update) => {
    const {name} = update;
    switch (name) {
      case 'position': {
        const service = accessory.getService(Service.WindowCovering);
        assert(service, `Unexpected missing service "Service.WindowCovering" in accessory`);
        service.getCharacteristic(CurrentPosition)!.updateValue(update!.value as number);
        return;
      }
      default:
        return;
    }
  });
};

/*
// https://github.com/mgcrea/homebridge-tydom/issues/2
{name: 'thermicDefect', validity: 'upToDate', value: false},
{name: 'position', validity: 'upToDate', value: 98},
{name: 'onFavPos', validity: 'upToDate', value: false},
{name: 'obstacleDefect', validity: 'upToDate', value: false},
{name: 'intrusion', validity: 'upToDate', value: false},
{name: 'battDefect', validity: 'upToDate', value: false}
*/
