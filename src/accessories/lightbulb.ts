import type {PlatformAccessory} from 'homebridge';
import {debounce, find} from 'lodash';
import TydomController from '../controller';
import {TydomAccessoryContext, TydomEndpointData} from '../typings/tydom';
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from '../helpers/accessory';
import {chalkNumber, chalkString} from '../utils/chalk';
import {debug, debugGet, debugGetResult, debugSet, debugSetResult, debugSetUpdate, debugTydomPut} from '../utils/debug';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from '../config/hap';
import {getTydomDataPropValue, getTydomDeviceData} from '../helpers/tydom';
import {addAccessorySwitchableService, updateAccessorySwitchableService} from './services/switchableService';

type LightbulbSettings = Record<string, never>;

type LightbulbState = {
  latestBrightness: number;
  pendingUpdatedValues: number[];
  lastUpdatedAt: number;
};

type LightbulbContext = TydomAccessoryContext<LightbulbSettings, LightbulbState>;

export const setupLightbulb = (accessory: PlatformAccessory<LightbulbContext>, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;
  const {On, Brightness} = Characteristic;

  const {deviceId, endpointId, metadata, state} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  Object.assign(state, {
    latestBrightness: 100,
    pendingUpdatedValues: [],
    lastUpdatedAt: 0
  });

  const levelMeta = find(metadata, {name: 'level'});

  // Not dimmable
  if (levelMeta?.step === 100) {
    addAccessorySwitchableService(accessory, controller, Service.Lightbulb);
    return;
  }

  // Dimmable
  const service = addAccessoryService(accessory, Service.Lightbulb, `${accessory.displayName}`, true);
  const debouncedSetLevel = debounce(
    async (value: number) => {
      debugTydomPut('level', accessory, value);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'level',
          value
        }
      ]);
      Object.assign(state, {
        pendingUpdatedValues: state.pendingUpdatedValues.concat([value])
      });
    },
    15,
    {leading: true, trailing: true}
  );

  service
    .getCharacteristic(Characteristic.On)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(On, service);
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
        const level = getTydomDataPropValue<number>(data, 'level');
        const nextValue = level > 0;
        debugGetResult(On, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(On, service, value);
      try {
        const nextLevel = value ? state.latestBrightness || 100 : 0;
        await debouncedSetLevel(nextLevel);
        service.updateCharacteristic(Brightness, nextLevel);
        debugSetResult(On, service, value);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    })
    .getValue();

  service
    .getCharacteristic(Characteristic.Brightness)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(Brightness, service);
      try {
        const data = await getTydomDeviceData<TydomEndpointData>(client, {deviceId, endpointId});
        const level = getTydomDataPropValue<number>(data, 'level');
        debugGetResult(Brightness, service, level);
        callback(null, level);
      } catch (err) {
        callback(err as Error);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(Brightness, service, value);
      try {
        const nextValue = value as number;
        Object.assign(state, {
          latestBrightness: nextValue,
          lastUpdatedAt: Date.now()
        });
        await debouncedSetLevel(nextValue);
        debugSetResult(Brightness, service, value);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    })
    .getValue();
};

export const updateLightbulb = (
  accessory: PlatformAccessory<LightbulbContext>,
  controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  const {context} = accessory;
  const {metadata, state} = context;
  const {On, Brightness} = Characteristic;
  const levelMeta = find(metadata, {name: 'level'});
  // Not dimmable
  if (levelMeta?.step === 100) {
    updateAccessorySwitchableService(accessory, controller, updates, Service.Lightbulb);
    return;
  }
  // Dimmable
  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'level': {
        const service = getAccessoryService(accessory, Service.Lightbulb);
        const level = value as number;
        if (level === null) {
          debug(`Encountered a ${chalkString('level')} update with a null value!`);
          return;
        }
        // @NOTE ignore pending updates
        if (state.pendingUpdatedValues.includes(level)) {
          debug(`Ignoring a delayed ${chalkString('level')} update with value=${chalkNumber(level)}`);
          // Reset pending updates stack
          state.pendingUpdatedValues = [];
          return;
        }
        debugSetUpdate(On, service, level > 0);
        service.updateCharacteristic(On, level > 0);
        // @NOTE Only update brightness for non-null values
        if (level > 0) {
          debugSetUpdate(Brightness, service, level);
          service.updateCharacteristic(Brightness, level);
        }
        return;
      }
      default:
        return;
    }
  });
};
