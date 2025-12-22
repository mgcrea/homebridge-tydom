import type { PlatformAccessory } from "homebridge";
import { debounce } from "lodash";
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service,
} from "../config/hap";
import TydomController from "../controller";
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
  TydomAccessoryUpdateType,
} from "../helpers/accessory";
import { getTydomDataPropValue, getTydomDeviceData } from "../helpers/tydom";
import type { TydomAccessoryContext, TydomDeviceShutterData } from "../typings/tydom";
import { asNumber } from "../utils";
import { chalkJson, chalkKeyword, chalkNumber, chalkString } from "../utils/color";
import {
  debug,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
  debugTydomPut,
} from "../utils/debug";

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
  const service = addAccessoryService(accessory, Service.WindowCovering, `${accessory.displayName}`, true);

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

  service
    .getCharacteristic(PositionState)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(PositionState, service);
      try {
        // @NOTE Tydom does not track the current position
        const nextValue = PositionState.STOPPED;
        debugGetResult(CurrentPosition, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
      }
    });

  service
    .getCharacteristic(HoldPosition)
    .on(
      CharacteristicEventTypes.SET,
      async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
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
        callback();
      },
    );

  service
    .getCharacteristic(CurrentPosition)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(CurrentPosition, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceShutterData>(client, { deviceId, endpointId });
        const position = getTydomDataPropValue<number>(data, "position") || 0;
        const nextValue = asNumber(position);
        debugGetResult(CurrentPosition, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
      }
    });

  service
    .getCharacteristic(TargetPosition)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(TargetPosition, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceShutterData>(client, { deviceId, endpointId });
        const position = getTydomDataPropValue<number>(data, "position") || 0;
        const nextValue = asNumber(position);
        debugGetResult(CurrentPosition, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
      }
    })
    .on(
      CharacteristicEventTypes.SET,
      async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        debugSet(TargetPosition, service, value);
        try {
          const nextValue = value as number;
          Object.assign(state, {
            latestPosition: nextValue,
            lastUpdatedAt: Date.now(),
          });
          await debouncedSetPosition(nextValue);
          debugSetResult(TargetPosition, service, value, nextValue);
          callback();
        } catch (err) {
          callback(err as Error);
        }
      },
    );
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
          debug(`Ignoring a pending ${chalkString("position")} update with value=${chalkNumber(position)} !`);
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
