import type { PlatformAccessory } from "homebridge";
import debounce from "lodash/debounce.js";
import { Characteristic, Service } from "../config/hap.js";
import type TydomController from "../controller.js";
import type { TydomAccessoryUpdateType } from "../helpers/accessory.js";
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "../helpers/accessory.js";
import { getTydomDataPropValue, getTydomDeviceData } from "../helpers/tydom.js";
import type { TydomAccessoryContext, TydomDeviceShutterData } from "../typings/tydom.js";
import { asNumber } from "../utils/basic.js";
import { chalkJson, chalkKeyword, chalkNumber, chalkString } from "../utils/color.js";
import {
  debug,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
  debugTydomPut,
} from "../utils/debug.js";

// const getReciprocalPositionForValue = (position: number): number => {
//   if (position === 0 || position === 100) {
//     return position;
//   }
//   return Math.max(0, 100 - position); // @NOTE might over-shoot
// };

type WindowCoveringSettings = {
  invertDirection?: boolean;
};

type WindowCoveringState = {
  latestPosition: number;
  pendingUpdatedValues: number[];
  lastUpdatedAt: number;
};

type WindowCoveringContext = TydomAccessoryContext<WindowCoveringSettings, WindowCoveringState>;

export const setupWindowCovering = (
  accessory: PlatformAccessory<WindowCoveringContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { CurrentPosition, TargetPosition, PositionState, HoldPosition } = Characteristic;

  const { deviceId, endpointId, state } = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  Object.assign(state, {
    latestPosition: 100,
    pendingUpdatedValues: [],
    lastUpdatedAt: 0,
  });

  // Add the actual accessory Service
  const service = addAccessoryService(
    accessory,
    Service.WindowCovering,
    accessory.displayName,
    true,
  );

  const debouncedSetPosition = debounce(
    async (value: number) => {
      debugTydomPut("position", accessory, value);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "position",
          value,
        },
      ]);
      Object.assign(state, {
        pendingUpdatedValues: state.pendingUpdatedValues.concat([value]),
      });
    },
    250,
    { leading: true, trailing: true },
  );

  service.getCharacteristic(PositionState).onGet(() => {
    debugGet(PositionState, service);
    // @NOTE Tydom does not track the current position
    const nextValue = PositionState.STOPPED;
    debugGetResult(CurrentPosition, service, nextValue);
    return nextValue;
  });

  service.getCharacteristic(HoldPosition).onSet(async (value) => {
    debugSet(HoldPosition, service, value);
    if (!value) {
      // @NOTE asked to not hold position
      return;
    }
    const nextValue = "STOP";
    debugTydomPut("positionCmd", accessory, nextValue);
    await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
      {
        name: "positionCmd",
        value: nextValue,
      },
    ]);
    debugSetResult(HoldPosition, service, value, nextValue);
  });

  service.getCharacteristic(CurrentPosition).onGet(async () => {
    debugGet(CurrentPosition, service);
    const data = await getTydomDeviceData<TydomDeviceShutterData>(client, { deviceId, endpointId });
    const position = getTydomDataPropValue<number>(data, "position") || 0;
    const nextValue = asNumber(position);
    debugGetResult(CurrentPosition, service, nextValue);
    return nextValue;
  });

  service
    .getCharacteristic(TargetPosition)
    .onGet(async () => {
      debugGet(TargetPosition, service);
      const data = await getTydomDeviceData<TydomDeviceShutterData>(client, {
        deviceId,
        endpointId,
      });
      const position = getTydomDataPropValue<number>(data, "position") || 0;
      const nextValue = asNumber(position);
      debugGetResult(CurrentPosition, service, nextValue);
      return nextValue;
    })
    .onSet(async (value) => {
      debugSet(TargetPosition, service, value);
      const nextValue = value as number;
      Object.assign(state, {
        latestPosition: nextValue,
        lastUpdatedAt: Date.now(),
      });
      await debouncedSetPosition(nextValue);
      debugSetResult(TargetPosition, service, value, nextValue);
    });
};

export const updateWindowCovering = (
  accessory: PlatformAccessory<WindowCoveringContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomAccessoryUpdateType,
): void => {
  const { context } = accessory;
  const { state } = context;
  const { CurrentPosition, TargetPosition, ObstructionDetected } = Characteristic;

  // Process command updates
  if (type === "cdata") {
    updates.forEach((update) => {
      const { values } = update;
      const { event } = values as { event: unknown };
      debug(`New ${chalkKeyword("WindowCovering")} event=${chalkJson(event)}`);
    });
    return;
  }

  updates.forEach((update) => {
    const { name, value } = update;
    switch (name) {
      case "position": {
        const service = getAccessoryService(accessory, Service.WindowCovering);
        const position = asNumber(value as number);
        if (position === null) {
          debug(`Encountered a ${chalkString("position")} update with a null value!`);
          return;
        }
        debugSetUpdate(CurrentPosition, service, position);
        service.updateCharacteristic(CurrentPosition, position);
        // @NOTE ignore pending updates
        if (state.pendingUpdatedValues.includes(position)) {
          debug(
            `Ignoring a pending ${chalkString("position")} update with value=${chalkNumber(position)} !`,
          );
          state.pendingUpdatedValues = [];
          return;
        }
        debugSetUpdate(TargetPosition, service, position);
        service.updateCharacteristic(TargetPosition, position);
        return;
      }
      case "obstacleDefect": {
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
