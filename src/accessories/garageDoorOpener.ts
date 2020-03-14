import {
  Characteristic,
  CharacteristicChange,
  CharacteristicEventTypes,
  CharacteristicValue,
  NodeCallback,
  Service
} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {
  addAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import debug from 'src/utils/debug';

export const setupGarageDoorOpener = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {displayName: name, UUID: id, context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.Switch, `${accessory.displayName}`, true);

  service
    .getCharacteristic(Characteristic.On)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      callback(null, false);
    })
    .on(CharacteristicEventTypes.CHANGE, async (value: CharacteristicChange) => {
      debug(`Setting device named="${name}" with id="${id}" value="${value.newValue}" ...`);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'levelCmd',
          value: 'TOGGLE'
        }
      ]);
    });
};

/*
accessory
  .addService(Service.GarageDoorOpener, tydomName) // Display name
  // .setCharacteristic(Characteristic.TargetDoorState, Characteristic.TargetDoorState.CLOSED) // force initial state to CLOSED
  .getCharacteristic(Characteristic.TargetDoorState)!
  .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    d({id, type: 'CharacteristicEventTypes.SET', value});
    if (value == Characteristic.TargetDoorState.CLOSED) {
      await client.put(`/devices/${tydomId}/endpoints/${tydomId}/data`, [
        {
          name: 'levelCmd',
          value: 'TOGGLE'
        }
      ]);
    } else if (value == Characteristic.TargetDoorState.OPEN) {
      await client.put(`/devices/${tydomId}/endpoints/${tydomId}/data`, [
        {
          name: 'levelCmd',
          value: 'TOGGLE'
        }
      ]);
    }
    callback();
  });
*/
