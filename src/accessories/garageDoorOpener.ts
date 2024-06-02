import debug from 'debug';
import {
  PlatformAccessory,
  CharacteristicEventTypes,
  NodeCallback,
  CharacteristicValue,
  CharacteristicSetCallback
} from 'homebridge';
import TydomController from 'src/controller';
import {
  setupAccessoryInformationService,
  setupAccessoryIdentifyHandler,
  addAccessoryService,
  TydomAccessoryUpdateType
} from 'src/helpers';
import {TydomAccessoryContext} from 'src/typings';
import {
  chalkString,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  asNumber,
  chalkNumber,
  waitFor,
  chalkKeyword,
  chalkJson
} from 'src/utils';
import {Characteristic, Service} from 'src/config/hap';

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

export const setupGarageDoorOpener = (
  accessory: PlatformAccessory<GarageDoorOpenerContext>,
  controller: TydomController
): void => {
  const {context} = accessory;
  const {client} = controller;
  const {CurrentDoorState, TargetDoorState} = Characteristic;

  const {deviceId, endpointId, state, settings} = context;

  const {delay: garageDoorDelay = DEFAULT_GARAGE_DOOR_DELAY, autoCloseDelay} = settings;

  const assignState = (update: Partial<GarageDoorOpenerState>): void => {
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
            const delay = ((100 - state.computedPosition) * garageDoorDelay) / 100;
            // debug(`delay=${chalkNumber(delay)}`);
            try {
              await waitFor(`${deviceId}.pending`, delay);
              assignCurrentDoorState(CurrentDoorState.OPEN);
              if (autoCloseDelay) {
                await waitFor(`${deviceId}.pending`, autoCloseDelay);
                const targetDoorState = service.getCharacteristic(Characteristic.TargetDoorState);
                targetDoorState.setValue(Characteristic.TargetDoorState.CLOSED);
              }
            } catch (err) {
              // debug(`Aborted OPEN update with delay=${chalkNumber(delay)}`);
            }
            break;
          }
          case CurrentDoorState.CLOSING: {
            const delay = (state.computedPosition * garageDoorDelay) / 100;
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
  accessory: PlatformAccessory<GarageDoorOpenerContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomAccessoryUpdateType
): void => {
  const {context: _context} = accessory;
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
    const {name, value: _value} = update;
    switch (name) {
      default:
        return;
    }
  });
};
