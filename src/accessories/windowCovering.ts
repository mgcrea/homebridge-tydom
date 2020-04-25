import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from 'hap-nodejs';
import {debounce} from 'lodash';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {TydomDeviceShutterData} from 'src/typings/tydom';
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import {debugGet, debugGetResult, debugSet, debugSetResult, debugSetUpdate, debugTydomPut} from 'src/utils/debug';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/utils/tydom';

const {CurrentPosition, TargetPosition, ObstructionDetected} = Characteristic;

const getReciprocalPositionForValue = (position: number): number => {
  if (position === 0 || position === 100) {
    return position;
  }
  return Math.min(0, 100 - position);
};

export const setupWindowCovering = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.WindowCovering, `${accessory.displayName}`, true);

  const debouncedSetPosition = debounce((value: number) => {
    debugTydomPut('position', accessory, value);
    client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
      {
        name: 'position',
        value
      }
    ]);
  }, 250);

  service
    .getCharacteristic(CurrentPosition)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(CurrentPosition, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceShutterData>(client, {deviceId, endpointId});
        const position = getTydomDataPropValue<number>(data, 'position') || 0;
        const nextValue = getReciprocalPositionForValue(position);
        debugGetResult(CurrentPosition, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .getValue();

  service
    .getCharacteristic(TargetPosition)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(TargetPosition, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceShutterData>(client, {deviceId, endpointId});
        const position = getTydomDataPropValue<number>(data, 'position') || 0;
        const nextValue = getReciprocalPositionForValue(position);
        debugGetResult(CurrentPosition, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(TargetPosition, service, value);
      try {
        const tydomValue = getReciprocalPositionForValue(value as number);
        debouncedSetPosition(tydomValue);
        debugSetResult(TargetPosition, service, value, tydomValue);
        callback();
      } catch (err) {
        callback(err);
      }
    })
    .getValue();
};

export const updateWindowCovering = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[]
) => {
  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'position': {
        const service = getAccessoryService(accessory, Service.WindowCovering);
        const nextValue = getReciprocalPositionForValue(value as number);
        debugSetUpdate(CurrentPosition, service, nextValue);
        service.updateCharacteristic(CurrentPosition, nextValue);
        service.updateCharacteristic(TargetPosition, nextValue);
        return;
      }
      case 'obstacleDefect': {
        const service = getAccessoryService(accessory, Service.WindowCovering);
        debugSetUpdate(ObstructionDetected, service, value);
        service.updateCharacteristic(ObstructionDetected, value as boolean);
        return;
      }
      default:
        return;
    }
  });
};
