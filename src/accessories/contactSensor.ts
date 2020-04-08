import {Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {TydomEndpointData} from 'src/typings/tydom';
import {
  addAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import {debugGet, debugGetResult} from 'src/utils/debug';
import {getTydomDeviceData, getTydomDataPropValue} from 'src/utils/tydom';

export const setupContactSensor = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {displayName: name, UUID: id, context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.ContactSensor, `${accessory.displayName}`, true);

  service
    .getCharacteristic(Characteristic.ContactSensorState)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('ContactSensorState', {name, id});
      try {
        const data = await getTydomDeviceData<TydomEndpointData>(client, {deviceId, endpointId});
        const intrusionDetect = getTydomDataPropValue<boolean>(data, 'intrusionDetect');
        debugGetResult('ContactSensorState', {name, id, value: intrusionDetect});
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
  const {ContactSensorState} = Characteristic;
  updates.forEach((update) => {
    const {name} = update;
    switch (name) {
      case 'intrusionDetect': {
        const service = accessory.getService(Service.ContactSensor);
        assert(service, `Unexpected missing service "Service.ContactSensor" in accessory`);
        service.getCharacteristic(ContactSensorState)!.updateValue(update!.value as boolean);
        return;
      }
      default:
        return;
    }
  });
};
