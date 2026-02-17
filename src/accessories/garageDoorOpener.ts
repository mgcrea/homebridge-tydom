import type { PlatformAccessory } from "homebridge";
import { Characteristic, Service } from "src/config/hap";
import TydomController from "src/controller";
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
  TydomAccessoryUpdateType,
} from "src/helpers";
import { getTydomDataPropValue, getTydomDeviceData } from "src/helpers/tydom";
import type { TydomAccessoryContext } from "src/typings";
import {
  asNumber,
  chalkJson,
  chalkKeyword,
  chalkNumber,
  chalkString,
  debug,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  waitFor,
} from "src/utils";
import TydomClient from "tydom-client";

type GarageDoorOpenerSettings = {
  delay?: number;
  autoCloseDelay?: number;
};
type GarageDoorOpenerState = {
  currentDoorState: number;
  targetDoorState: number;
  lastUpdatedAt: number;
  computedPosition: number;
};
type GarageDoorOpenerContext = TydomAccessoryContext<GarageDoorOpenerSettings, GarageDoorOpenerState>;

const DEFAULT_GARAGE_DOOR_DELAY = 20 * 1000;

const getTydomCurrentDoorState = async (client: TydomClient, deviceId: number, endpointId: number) => {
  const { CurrentDoorState } = Characteristic;
  try {
    const tydomDeviceData = await getTydomDeviceData(client, {
      deviceId,
      endpointId,
    });
    const tydomDeviceLevel = getTydomDataPropValue(tydomDeviceData, "level") || 0;
    let currentDoorState = CurrentDoorState.CLOSED;
    if (tydomDeviceLevel === 0) {
      currentDoorState = CurrentDoorState.CLOSED;
    } else if (tydomDeviceLevel === 100) {
      currentDoorState = CurrentDoorState.OPEN;
    } else if (tydomDeviceLevel > 0 && tydomDeviceLevel < 100) {
      const message = `Encountered a ${chalkString("level")} update with value different from 0 or 100 !`;
      debug(message);
    }
    return currentDoorState;
  } catch (err) {
    if (err instanceof Error && err.message === "UnreacheableAccessory") {
      debug(
        `⚠️ GarageDoor unreacheable for device with deviceId=${deviceId} and endpointId=${endpointId}`,
      );
      return Characteristic.CurrentDoorState.CLOSED;
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(String(err));
  }
};

export const setupGarageDoorOpener = (
  accessory: PlatformAccessory<GarageDoorOpenerContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { CurrentDoorState, TargetDoorState } = Characteristic;

  const { deviceId, endpointId, state, settings, metadata } = context;

  const levelCmdValues = metadata.find((m) => m.name === "levelCmd")?.enum_values;
  const IS_TOGGLE_ONLY = levelCmdValues?.length === 1 && levelCmdValues[0] === "TOGGLE";

  const { delay: garageDoorDelay = DEFAULT_GARAGE_DOOR_DELAY, autoCloseDelay } = settings;

  const assignState = (update: Partial<GarageDoorOpenerState>): void => {
    Object.assign(state, update);
  };

  const getDoorStateLabel = (currentDoorState: number) => {
    switch (currentDoorState) {
      case CurrentDoorState.OPEN:
        return "OPEN";
      case CurrentDoorState.CLOSED:
        return "CLOSED";
      case CurrentDoorState.OPENING:
        return "OPENING";
      case CurrentDoorState.CLOSING:
        return "CLOSING";
      case CurrentDoorState.STOPPED:
        return "STOPPED";
    }
    return "UNKNOWN";
  };

  const getLevelCmdForCurrentDoorState = (targetDoorState: number) => {
    switch (state.currentDoorState) {
      case CurrentDoorState.OPEN:
        switch (targetDoorState) {
          case TargetDoorState.CLOSED:
            return "OFF";
          case TargetDoorState.OPEN:
            return "ON";
        }
        break;
      case CurrentDoorState.CLOSED:
        switch (targetDoorState) {
          case TargetDoorState.CLOSED:
            return "OFF";
          case TargetDoorState.OPEN:
            return "ON";
        }
        break;
      case CurrentDoorState.OPENING:
      case CurrentDoorState.CLOSING:
        return "STOP";
      case CurrentDoorState.STOPPED:
        switch (targetDoorState) {
          case TargetDoorState.CLOSED:
            return "OFF";
          case TargetDoorState.OPEN:
            return "ON";
        }
        break;
    }
    return "UNKNOWN";
  };

  const assignCurrentDoorState = (currentDoorState: number) => {
    debug(`assignCurrentDoorState=${chalkString(getDoorStateLabel(currentDoorState))}`);
    Object.assign(state, { currentDoorState });
    service.updateCharacteristic(CurrentDoorState, currentDoorState);
  };

  const toggleGarageDoor = async (targetDoorState: number) => {
    const cmdValue = IS_TOGGLE_ONLY ? "TOGGLE" : getLevelCmdForCurrentDoorState(targetDoorState);
    debug(`sending levelCmd=${cmdValue} for GarageDoor with deviceId:${deviceId}`);
    await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
      {
        name: "levelCmd",
        value: cmdValue,
      },
    ]);
  };

  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  assignState({
    currentDoorState: CurrentDoorState.CLOSED,
    targetDoorState: TargetDoorState.CLOSED,
    lastUpdatedAt: 0,
    computedPosition: 0, // 0 <-> 100%
  });

  const getNextCurrentDoorState = (targetDoorState: number) => {
    switch (state.currentDoorState) {
      case CurrentDoorState.OPEN: {
        switch (targetDoorState) {
          case TargetDoorState.CLOSED:
            return CurrentDoorState.CLOSING;
          case TargetDoorState.OPEN:
            return CurrentDoorState.OPEN;
        }
        break;
      }
      case CurrentDoorState.CLOSED: {
        switch (targetDoorState) {
          case TargetDoorState.CLOSED:
            return CurrentDoorState.CLOSED;
          case TargetDoorState.OPEN:
            return CurrentDoorState.OPENING;
        }
        break;
      }
      case CurrentDoorState.CLOSING:
      case CurrentDoorState.OPENING: {
        return CurrentDoorState.STOPPED;
      }
      case CurrentDoorState.STOPPED: {
        switch (targetDoorState) {
          case TargetDoorState.CLOSED:
            return CurrentDoorState.CLOSING;
          case TargetDoorState.OPEN:
            return CurrentDoorState.OPENING;
        }
        break;
      }
    }
    return CurrentDoorState.CLOSED;
  };

  const computeCurrentPosition = (): number => {
    const { lastUpdatedAt, computedPosition: lastComputedPosition, currentDoorState } = state;
    const elapsed = Date.now() - lastUpdatedAt;
    switch (currentDoorState) {
      case CurrentDoorState.STOPPED: {
        return lastComputedPosition;
      }
      case CurrentDoorState.OPEN: {
        return 100;
      }
      case CurrentDoorState.CLOSED: {
        return 0;
      }
      case CurrentDoorState.OPENING: {
        return Math.min(100, lastComputedPosition + 100 * (elapsed / garageDoorDelay));
      }
      case CurrentDoorState.CLOSING: {
        return Math.max(0, lastComputedPosition - 100 * (elapsed / garageDoorDelay));
      }
    }
    return 0;
  };

  // Add the actual accessory Service
  const legacyService = accessory.getService(Service.Switch);
  if (legacyService) {
    accessory.removeService(legacyService);
  }
  const service = addAccessoryService(accessory, Service.GarageDoorOpener, accessory.displayName, true);

  service.getCharacteristic(CurrentDoorState).onGet(async () => {
    debugGet(CurrentDoorState, service);
    try {
      if (IS_TOGGLE_ONLY) {
        const currentDoorState2 = state.currentDoorState;
        debugGetResult(CurrentDoorState, service, currentDoorState2);
        return currentDoorState2;
      }
      const currentDoorState = await getTydomCurrentDoorState(client, deviceId, endpointId);
      debugGetResult(CurrentDoorState, service, currentDoorState);
      assignState({
        currentDoorState,
        lastUpdatedAt: Date.now(),
        computedPosition: currentDoorState === CurrentDoorState.OPEN ? 100 : 0,
      });
      debug(
        `current state = ${state.currentDoorState === CurrentDoorState.OPEN ? "OPEN" : "CLOSE"}`,
      );
      return currentDoorState;
    } catch (err) {
      if (err instanceof Error && err.message === "UnreacheableAccessory") {
        debug(
          `⚠️ GarageDoor unreacheable for accessory with deviceId=${deviceId} and endpointId=${endpointId}`,
        );
        return CurrentDoorState.CLOSED;
      }
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(String(err));
    }
  });

  service
    .getCharacteristic(TargetDoorState)
    .onGet(async () => {
      debugGet(TargetDoorState, service);
      try {
        if (IS_TOGGLE_ONLY) {
          const targetDoorState2 = state.currentDoorState;
          debugGetResult(TargetDoorState, service, targetDoorState2);
          return targetDoorState2;
        }
        const targetDoorState = await getTydomCurrentDoorState(client, deviceId, endpointId);
        debugGetResult(TargetDoorState, service, targetDoorState);
        assignState({
          targetDoorState,
          lastUpdatedAt: Date.now(),
          computedPosition: targetDoorState === TargetDoorState.OPEN ? 100 : 0,
        });
        debug(
          `target state = ${state.targetDoorState === TargetDoorState.OPEN ? "OPEN" : "CLOSE"}`,
        );
        return targetDoorState;
      } catch (err) {
        if (err instanceof Error && err.message === "UnreacheableAccessory") {
          debug(
            `⚠️ GarageDoor unreacheable for accessory with deviceId=${deviceId} and endpointId=${endpointId}`,
          );
          return TargetDoorState.CLOSED;
        }
        if (err instanceof Error) {
          throw err;
        }
        throw new Error(String(err));
      }
    })
    .onSet(async (value) => {
      debugSet(TargetDoorState, service, value);
      debugSetResult(TargetDoorState, service, value);
      const targetDoorState = asNumber(value);
      assignState({
        targetDoorState: targetDoorState,
        lastUpdatedAt: Date.now(),
        computedPosition: computeCurrentPosition(),
      });
      debug(`computedPosition=${chalkNumber(state.computedPosition)}`);
      let nextCurrentDoorState = getNextCurrentDoorState(targetDoorState);
      debug(`nextCurrentDoorState=${chalkString(getDoorStateLabel(nextCurrentDoorState))}`);
      if (nextCurrentDoorState === state.currentDoorState) {
        debug(`nextCurrentDoorState=${chalkNumber(nextCurrentDoorState)} === state.currentDoorState`);
        return;
      }
      await toggleGarageDoor(targetDoorState);
      assignCurrentDoorState(nextCurrentDoorState);

      // Handle Stopped state, if we are stopped, wait one second and trigger again to reverse course
      // eg. Stopped -> Closing if target is Closed
      if (nextCurrentDoorState === CurrentDoorState.STOPPED) {
        await waitFor("stopping", 1000);
        assignState({
          targetDoorState: targetDoorState,
          lastUpdatedAt: Date.now(),
          computedPosition: computeCurrentPosition(),
        });
        debug(`computedPosition=${chalkNumber(state.computedPosition)}`);
        nextCurrentDoorState = getNextCurrentDoorState(targetDoorState);
        debug(`nextCurrentDoorState=${chalkString(getDoorStateLabel(nextCurrentDoorState))}`);
        await toggleGarageDoor(targetDoorState);
        assignCurrentDoorState(nextCurrentDoorState);
      }

      // Finally update pending states (fire-and-forget)
      void (async () => {
        switch (nextCurrentDoorState) {
          case CurrentDoorState.OPENING: {
            const delay = ((100 - state.computedPosition) * garageDoorDelay) / 100;
            debug(`delay=${chalkNumber(delay)}`);
            try {
              await waitFor(`${deviceId}.pending`, delay);
              assignCurrentDoorState(CurrentDoorState.OPEN);
              if (autoCloseDelay) {
                await waitFor(`${deviceId}.pending`, autoCloseDelay);
                assignCurrentDoorState(CurrentDoorState.CLOSED);
              }
            } catch (err) {
              debug(`Aborted OPEN update with delay=${chalkNumber(delay)}`);
            }
            break;
          }
          case CurrentDoorState.CLOSING: {
            const delay = (state.computedPosition * garageDoorDelay) / 100;
            debug(`delay=${chalkNumber(delay)}`);
            try {
              await waitFor(`${deviceId}.pending`, delay);
              assignCurrentDoorState(CurrentDoorState.CLOSED);
            } catch (err) {
              debug(`Aborted CLOSED update with delay=${chalkNumber(delay)}`);
            }
            break;
          }
        }
      })();
    });

  // const switchService = addAccessoryService(accessory, Service.Switch, `${accessory.displayName} Switch`, true);
  // debugAddSubService(switchService, accessory);
  // service.addLinkedService(switchService);

  // switchService
  //   .getCharacteristic(Characteristic.On)
  //   .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
  //     debugSet(Characteristic.On, service, value);
  //     if (!value) {
  //       callback();
  //       return;
  //     }
  //     try {
  //       await toggleGarageDoor();
  //       debugSetResult(Characteristic.On, service, value);
  //       callback();
  //       setTimeout(() => {
  //         service.updateCharacteristic(Characteristic.On, false);
  //       }, 1000);
  //     } catch (err) {
  //       callback(err as Error);
  //     }
  //   })
  //   .updateValue(false);
};

export const updateGarageDoorOpener = (
  accessory: PlatformAccessory<GarageDoorOpenerContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomAccessoryUpdateType,
): void => {
  const { context } = accessory;
  const { state } = context;
  const { CurrentDoorState, TargetDoorState } = Characteristic;

  // Process command updates
  if (type === "cdata") {
    updates.forEach((update) => {
      const { values } = update;
      const { event } = values as { event: unknown };
      debug(`New ${chalkKeyword("GarageDoorOpener")} event=${chalkJson(event)}`);
    });
    return;
  }

  updates.forEach((update) => {
    const { name, value: value } = update;
    const service = getAccessoryService(accessory, Service.GarageDoorOpener);
    debug(
      `New ${chalkKeyword("GarageDoorOpener")} update received from Tydom, name=${String(name)} / value=${String(value)}`,
    );
    switch (name) {
      case "level": {
        // Updates are to be processed only in case external remote triggered the event
        // In case of Homebridge, the door is already in CLOSING/OPENING state and will be CLOSED/OPENED after garageDoorDelay.
        if (
          state.currentDoorState === CurrentDoorState.OPENING || // 2
          state.currentDoorState === CurrentDoorState.CLOSING // 3
        ) {
          debug(`GarageDoor state is OPENING or CLOSING, ignoring update.`);
        }
        const level = asNumber(value as number);
        let doorState = CurrentDoorState.CLOSED;
        let computedPosition = 0;
        if (level === 0) {
          doorState = CurrentDoorState.CLOSED; // 1
          computedPosition = 0;
        } else if (level === 100) {
          doorState = CurrentDoorState.OPEN; // 0
          computedPosition = 100;
        } else if (level > 0 && level < 100) {
          debug(`Encountered a ${chalkString("level")} update with value different from 0 or 100 !`);
          return;
        }
        // Update CurrentDoorState
        debugSetResult(CurrentDoorState, service, doorState);
        service.updateCharacteristic(CurrentDoorState, doorState);
        // Update TargetDoorState
        debugSetResult(TargetDoorState, service, doorState);
        service.updateCharacteristic(TargetDoorState, doorState);

        Object.assign(state, {
          currentDoorState: doorState,
          targetDoorState: doorState,
          lastUpdatedAt: Date.now(),
          computedPosition: computedPosition,
        });
        return;
      }
      default:
        return;
    }
  });
};
