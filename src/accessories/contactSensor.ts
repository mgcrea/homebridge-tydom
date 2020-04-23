import {Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {TydomEndpointData} from 'src/typings/tydom';
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import {debugGet, debugGetResult, debugSetUpdate} from 'src/utils/debug';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/utils/tydom';

const {ContactSensorState} = Characteristic;

export const setupContactSensor = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.ContactSensor, `${accessory.displayName}`, true);

  service
    .getCharacteristic(ContactSensorState)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(ContactSensorState, service);
      try {
        const data = await getTydomDeviceData<TydomEndpointData>(client, {deviceId, endpointId});
        const intrusionDetect = getTydomDataPropValue<boolean>(data, 'intrusionDetect');
        debugGetResult(ContactSensorState, service, intrusionDetect);
        callback(null, intrusionDetect);
      } catch (err) {
        callback(err);
      }
    });
};

export const updateContactSensor = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[]
) => {
  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'intrusionDetect': {
        const service = getAccessoryService(accessory, Service.ContactSensor);
        debugSetUpdate(ContactSensorState, service, value);
        service.updateCharacteristic(ContactSensorState, value as boolean);
        return;
      }
      default:
        return;
    }
  });
};
