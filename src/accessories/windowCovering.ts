import type {PlatformAccessory} from 'homebridge';
import {debounce} from 'lodash';
import TydomController from '../controller';
import type {TydomAccessoryContext, TydomDeviceShutterData} from '../typings/tydom';
import {
  addAccessoryService,
  asNumber,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from '../utils/accessory';
import {chalkNumber, chalkString} from '../utils/chalk';
import {debug, debugGet, debugGetResult, debugSet, debugSetResult, debugSetUpdate, debugTydomPut} from '../utils/debug';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from '../utils/hap';
import {getTydomDataPropValue, getTydomDeviceData} from '../utils/tydom';

// const getReciprocalPositionForValue = (position: number): number => {
//   if (position === 0 || position === 100) {
//     return position;
//   }
//   return Math.max(0, 100 - position); // @NOTE might over-shoot
// };

type State = {
  latestPosition: number;
  lastUpdatedAt: number;
};

export const setupWindowCovering = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;
  const {CurrentPosition, TargetPosition} = Characteristic;

  const {
    deviceId,
    endpointId,
    state = {
      latestPosition: 100,
      lastUpdatedAt: 0
    }
  } = context as TydomAccessoryContext<State>;
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
        const nextValue = asNumber(position);
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
        const nextValue = asNumber(position);
        debugGetResult(CurrentPosition, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(TargetPosition, service, value);
      try {
        const nextValue = value as number;
        Object.assign(state, {
          latestPosition: nextValue,
          lastUpdatedAt: Date.now()
        });
        debouncedSetPosition(nextValue);
        debugSetResult(TargetPosition, service, value, nextValue);
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
): void => {
  const {context} = accessory;
  const {state} = context as TydomAccessoryContext<State>;
  const {CurrentPosition, TargetPosition, ObstructionDetected} = Characteristic;
  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'position': {
        const service = getAccessoryService(accessory, Service.WindowCovering);
        const position = asNumber(value as number);
        if (position === null) {
          debug(`Encountered a ${chalkString('position')} update with a null value!`);
          return;
        }
        // @NOTE ignore invalid delayed updates when a set has occured <10s
        if (Date.now() - state.lastUpdatedAt < 10e3) {
          debug(`Ignoring a delayed ${chalkString('level')} update with value=${chalkNumber(position)} !`);
          return;
        }
        debugSetUpdate(CurrentPosition, service, position);
        service.updateCharacteristic(CurrentPosition, position);
        debugSetUpdate(TargetPosition, service, position);
        service.updateCharacteristic(TargetPosition, position);
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
