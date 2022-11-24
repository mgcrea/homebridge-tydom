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
  addAccessoryServiceWithSubtype,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
  TydomAccessoryUpdateType
} from '../helpers/accessory';
import type {TydomAccessoryContext} from '../typings/tydom';
import {waitFor, asNumber} from '../utils/basic';
import {chalkJson, chalkKeyword, chalkNumber, chalkString} from '../utils/chalk';
import {debug, debugAddSubService, debugGet, debugGetResult, debugSet, debugSetResult} from '../utils/debug';

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

  const GARAGE_DOOR_DELAY = 20 * 1000;
  const {deviceId, endpointId, state} = context as TydomAccessoryContext<State>;
  const assignState = (update: Partial<State>): void => {
    Object.assign(state, update);
  };

  const getDoorStateLabel = (currentDoorState: number) => {
    switch (currentDoorState) {
      case CurrentDoorState.OPEN:
        return 'OPEN';
      case CurrentDoorState.CLOSED:
        return 'CLOSED';
      case CurrentDoorState.OPENING:
        return 'OPENING';
      case CurrentDoorState.CLOSING:
        return 'CLOSING';
      case CurrentDoorState.STOPPED:
        return 'STOPPED';
    }
    return 'UNKNOWN';
  };

  const assignCurrentDoorState = (currentDoorState: number) => {
    debug(`assignCurrentDoorState=${chalkString(getDoorStateLabel(currentDoorState))}`);
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
    computedPosition: 0 // 0 <-> 100%
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
    const {lastUpdatedAt, computedPosition: lastComputedPosition, currentDoorState} = state;
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
        return Math.min(100, lastComputedPosition + 100 * (elapsed / GARAGE_DOOR_DELAY));
      }
      case CurrentDoorState.CLOSING: {
        return Math.max(0, lastComputedPosition - 100 * (elapsed / GARAGE_DOOR_DELAY));
      }
    }
    return 0;
  };

  // Add the actual accessory Service
  const legacyService = accessory.getService(Service.Switch);
  if (legacyService) {
    accessory.removeService(legacyService);
  }
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
      try {
        debugSetResult(TargetDoorState, service, value);
        const targetDoorState = asNumber(value);
        assignState({
          targetDoorState: targetDoorState,
          lastUpdatedAt: Date.now(),
          computedPosition: computeCurrentPosition()
        });
        // debug(`computedPosition=${chalkNumber(state.computedPosition)}`);
        let nextCurrentDoorState = getNextCurrentDoorState(targetDoorState);
        // debug(`nextCurrentDoorState=${chalkString(getDoorStateLabel(nextCurrentDoorState))}`);
        if (nextCurrentDoorState === state.currentDoorState) {
          debug(`nextCurrentDoorState=${chalkNumber(nextCurrentDoorState)} === state.currentDoorState`);
          callback();
          return;
        }
        await toggleGarageDoor();
        assignCurrentDoorState(nextCurrentDoorState);

        // Handle Stopped state, if we are stopped, wait one second and trigger again to reverse course
        // eg. Stopped -> Closing if target is Closed
        if (nextCurrentDoorState === CurrentDoorState.STOPPED) {
          await waitFor('stopping', 1000);
          assignState({
            targetDoorState: targetDoorState,
            lastUpdatedAt: Date.now(),
            computedPosition: computeCurrentPosition()
          });
          // debug(`computedPosition=${chalkNumber(state.computedPosition)}`);
          nextCurrentDoorState = getNextCurrentDoorState(targetDoorState);
          // debug(`nextCurrentDoorState=${chalkString(getDoorStateLabel(nextCurrentDoorState))}`);
          await toggleGarageDoor();
          assignCurrentDoorState(nextCurrentDoorState);
        }
        callback();

        // Finally update pending states
        switch (nextCurrentDoorState) {
          case CurrentDoorState.OPENING: {
            const delay = ((100 - state.computedPosition) * GARAGE_DOOR_DELAY) / 100;
            // debug(`delay=${chalkNumber(delay)}`);
            try {
              await waitFor(`${deviceId}.pending`, delay);
              assignCurrentDoorState(CurrentDoorState.OPEN);
            } catch (err) {
              // debug(`Aborted OPEN update with delay=${chalkNumber(delay)}`);
            }
            break;
          }
          case CurrentDoorState.CLOSING: {
            const delay = (state.computedPosition * GARAGE_DOOR_DELAY) / 100;
            // debug(`delay=${chalkNumber(delay)}`);
            try {
              await waitFor(`${deviceId}.pending`, delay);
              assignCurrentDoorState(CurrentDoorState.CLOSED);
            } catch (err) {
              // debug(`Aborted CLOSED update with delay=${chalkNumber(delay)}`);
            }
            break;
          }
        }
      } catch (err) {
        callback(err as Error);
      }
    })
    .getValue();

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
