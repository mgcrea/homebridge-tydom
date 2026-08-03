import debug from "debug";
import type { PlatformAccessory } from "homebridge";
import debounce from "lodash/debounce.js";
import find from "lodash/find.js";
import { Characteristic, Service } from "../config/hap.js";
import type TydomController from "../controller.js";
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "../helpers/accessory.js";
import { getTydomDataPropValue, getTydomDeviceData } from "../helpers/tydom.js";
import type { TydomAccessoryContext } from "../typings/tydom.js";
import { styleNumber, styleString } from "../util/style.js";
import {
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
  debugTydomPut,
} from "../platform/trace.js";
import {
  addAccessorySwitchableService,
  updateAccessorySwitchableService,
} from "./services/switchableService.js";

type LightbulbSettings = Record<string, never>;

type LightbulbState = {
  latestBrightness: number;
  pendingUpdatedValues: number[];
  lastUpdatedAt: number;
};

type LightbulbContext = TydomAccessoryContext<LightbulbSettings, LightbulbState>;

export const setupLightbulb = (
  accessory: PlatformAccessory<LightbulbContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { On, Brightness } = Characteristic;

  const { deviceId, endpointId, metadata, state } = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  Object.assign(state, {
    latestBrightness: 100,
    pendingUpdatedValues: [],
    lastUpdatedAt: 0,
  });

  const levelMeta = find(metadata, { name: "level" });

  // Not dimmable
  if (levelMeta?.step === 100) {
    addAccessorySwitchableService(accessory, controller, Service.Lightbulb);
    return;
  }

  // Dimmable
  const service = addAccessoryService(accessory, Service.Lightbulb, accessory.displayName, true);
  const debouncedSetLevel = debounce(
    async (value: number) => {
      debugTydomPut("level", accessory, value);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "level",
          value,
        },
      ]);
      Object.assign(state, {
        pendingUpdatedValues: state.pendingUpdatedValues.concat([value]),
      });
    },
    15,
    { leading: true, trailing: true },
  );

  service
    .getCharacteristic(Characteristic.On)
    .onGet(async () => {
      debugGet(On, service);
      const data = await getTydomDeviceData(client, { deviceId, endpointId });
      const level = getTydomDataPropValue<number>(data, "level");
      const nextValue = level > 0;
      debugGetResult(On, service, nextValue);
      return nextValue;
    })
    .onSet(async (value) => {
      debugSet(On, service, value);
      const nextLevel = value ? state.latestBrightness || 100 : 0;
      await debouncedSetLevel(nextLevel);
      service.updateCharacteristic(Brightness, nextLevel);
      debugSetResult(On, service, value);
    });

  service
    .getCharacteristic(Characteristic.Brightness)
    .onGet(async () => {
      debugGet(Brightness, service);
      const data = await getTydomDeviceData(client, { deviceId, endpointId });
      const level = getTydomDataPropValue<number>(data, "level");
      debugGetResult(Brightness, service, level);
      return level;
    })
    .onSet(async (value) => {
      debugSet(Brightness, service, value);
      const nextValue = value as number;
      Object.assign(state, {
        latestBrightness: nextValue,
        lastUpdatedAt: Date.now(),
      });
      await debouncedSetLevel(nextValue);
      debugSetResult(Brightness, service, value);
    });
};

export const updateLightbulb = (
  accessory: PlatformAccessory<LightbulbContext>,
  controller: TydomController,
  updates: Record<string, unknown>[],
): void => {
  const { context } = accessory;
  const { metadata, state } = context;
  const { On, Brightness } = Characteristic;
  const levelMeta = find(metadata, { name: "level" });
  // Not dimmable
  if (levelMeta?.step === 100) {
    updateAccessorySwitchableService(accessory, controller, updates, Service.Lightbulb);
    return;
  }
  // Dimmable
  updates.forEach((update) => {
    const { name, value } = update;
    switch (name) {
      case "level": {
        const service = getAccessoryService(accessory, Service.Lightbulb);
        const level = value as number;
        if (level === null) {
          debug(`Encountered a ${styleString("level")} update with a null value!`);
          return;
        }
        // @NOTE ignore pending updates
        if (state.pendingUpdatedValues.includes(level)) {
          debug(
            `Ignoring a delayed ${styleString("level")} update with value=${styleNumber(level)}`,
          );
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
