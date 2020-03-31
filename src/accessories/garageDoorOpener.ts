import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
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
import {debugSet, debugSetResult} from 'src/utils/debug';

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
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('On', {name, id, value});
      if (value) {
        const nextValue = 'TOGGLE';
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
          {
            name: 'level',
            value: nextValue
          }
        ]);
        debugSetResult('On', {name, id, value: nextValue});
      }
      callback();
    });
  // .on(CharacteristicEventTypes.CHANGE, async (value: CharacteristicChange) => {
  //   debugSet('On', {name, id, value});
  //   const nextValue = 'TOGGLE';
  //   await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
  //     {
  //       name: 'levelCmd',
  //       value: nextValue
  //     }
  //   ]);
  //   debugSetResult('On', {name, id, value: nextValue});
  // });
};
