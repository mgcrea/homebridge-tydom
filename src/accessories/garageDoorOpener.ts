import type {PlatformAccessory} from 'homebridge';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from '../config/hap';
import TydomController from '../controller';
import {
  addAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
  TydomAccessoryUpdateType
} from '../helpers/accessory';
import type {TydomAccessoryContext} from '../typings/tydom';
import {waitFor, asNumber} from '../utils/basic';
import {chalkJson, chalkKeyword, chalkNumber} from '../utils/chalk';
import {debug, debugGet, debugGetResult, debugSet, debugSetResult} from '../utils/debug';

type State = {
  currentDoorState: number;
  targetDoorState: number;
  lastUpdatedAt: number;
  computedPosition: number;
};

export const setupGarageDoorOpener = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;
  const {CurrentDoorState, TargetDoorState} = Characteristic;

  const GARAGE_DOOR_DELAY = 15 * 1000;
  const {deviceId, endpointId, state} = context as TydomAccessoryContext<State>;
  const assignState = (update: Partial<State>): void => {
    Object.assign(state, update);
  };
  const assignCurrentDoorState = (currentDoorState: number) => {
    Object.assign(state, {currentDoorState});
    service.updateCharacteristic(CurrentDoorState, currentDoorState);
  };

  const toggleGarageDoor = async () =>
    await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
      {
        name: 'levelCmd',
        value: 'TOGGLE'
      }
    ]);

  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  assignState({
    currentDoorState: CurrentDoorState.CLOSED,
    targetDoorState: TargetDoorState.CLOSED,
    lastUpdatedAt: 0,
    computedPosition: 0 // 0 <-> GARAGE_DOOR_DELAY
  });

  const getNextCurrentDoorState = (targetDoorState: number) => {
    switch (state.currentDoorState) {
      case CurrentDoorState.OPEN: {
        switch (targetDoorState) {
          case TargetDoorState.CLOSED:
            return CurrentDoorState.OPENING;
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
            return CurrentDoorState.CLOSING;
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
    const {lastUpdatedAt, computedPosition: lastComputedPosition, currentDoorState} = state;
    const elapsed = lastUpdatedAt - Date.now();
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
        return Math.min(100, lastComputedPosition + elapsed / GARAGE_DOOR_DELAY);
      }
      case CurrentDoorState.CLOSING: {
        return Math.max(0, lastComputedPosition - elapsed / GARAGE_DOOR_DELAY);
      }
    }
    return 0;
  };

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.GarageDoorOpener, `${accessory.displayName}`, true);

  service
    .getCharacteristic(CurrentDoorState)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(CurrentDoorState, service);
      try {
        const nextValue = state.currentDoorState;
        debugGetResult(CurrentDoorState, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
      }
    })
    .getValue();

  service
    .getCharacteristic(TargetDoorState)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(TargetDoorState, service);
      try {
        const nextValue = state.targetDoorState;
        debugGetResult(TargetDoorState, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(TargetDoorState, service, value);
      if (!value) {
        callback();
        return;
      }
      try {
        debugSetResult(TargetDoorState, service, value);
        const targetDoorState = asNumber(value);
        assignState({
          targetDoorState: targetDoorState,
          lastUpdatedAt: Date.now(),
          computedPosition: computeCurrentPosition()
        });
        let nextCurrentDoorState = getNextCurrentDoorState(targetDoorState);
        if (nextCurrentDoorState === state.currentDoorState) {
          debug(`nextCurrentDoorState=${chalkNumber(nextCurrentDoorState)} === state.currentDoorState`);
          callback();
          return;
        }
        await toggleGarageDoor();
        assignCurrentDoorState(nextCurrentDoorState);
        callback();

        // Handle Stopped state, if we are stopped, wait one second and trigger again to reverse course
        // eg. Stopped -> Closing if target is Closed
        if (nextCurrentDoorState === CurrentDoorState.STOPPED) {
          await waitFor(1000);
          assignState({
            targetDoorState: targetDoorState,
            lastUpdatedAt: Date.now(),
            computedPosition: computeCurrentPosition()
          });
          nextCurrentDoorState = getNextCurrentDoorState(targetDoorState);
          await toggleGarageDoor();
          assignCurrentDoorState(nextCurrentDoorState);
        }

        // Finally update pending states
        switch (nextCurrentDoorState) {
          case CurrentDoorState.OPENING:
            await waitFor((100 - state.computedPosition) * GARAGE_DOOR_DELAY);
            assignCurrentDoorState(CurrentDoorState.OPEN);
            break;
          case CurrentDoorState.CLOSING:
            await waitFor(state.computedPosition * GARAGE_DOOR_DELAY);
            assignCurrentDoorState(CurrentDoorState.CLOSED);
            break;
        }
      } catch (err) {
        callback(err as Error);
      }
    })
    .getValue();
};

export const updateGarageDoorOpener = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomAccessoryUpdateType
): void => {
  const {context} = accessory;
  // const {state} = context as TydomAccessoryContext<State>;

  // Process command updates
  if (type === 'cdata') {
    updates.forEach((update) => {
      const {values} = update;
      const {event} = values as {event: unknown};
      debug(`New ${chalkKeyword('GarageDoorOpener')} event=${chalkJson(event)}`);
    });
    return;
  }

  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      default:
        return;
    }
  });
};
