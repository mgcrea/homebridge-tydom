import {
  Service,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicValue,
  CharacteristicSetCallback,
  NodeCallback
} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {setupAccessoryIdentifyHandler, setupAccessoryInformationService} from 'src/utils/accessory';
import {addAccessorySwitchableService, updateAccessorySwitchableService} from './services/switchableService';
import {find} from 'lodash';
import debug from 'src/utils/debug';
import {getTydomDeviceData} from 'src/utils/tydom';
import {TydomEndpointData} from 'src/typings/tydom';
import assert from 'src/utils/assert';

export const setupLightbulb = (accessory: PlatformAccessory, controller: TydomController): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  const service = addAccessorySwitchableService(accessory, controller, Service.Lightbulb);

  const {displayName: name, UUID: id, context} = accessory;
  const {deviceId, endpointId, metadata} = context;
  const {client} = controller;

  const levelMeta = find(metadata, {name: 'level'});
  // Not dimmable
  if (levelMeta?.step === 100) {
    return;
  }

  const serviceBrightnessCharacteristic = service.getCharacteristic(Characteristic.Brightness)!;

  serviceBrightnessCharacteristic.on(
    CharacteristicEventTypes.SET,
    async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debug(`Setting device named="${name}" with id="${id}" value="${value}" ...`);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'level',
          value: parseInt(`${value}`, 10)
        }
      ]);
      debug(`Sucessfully set device named="${name}" with id="${id}" value="${value}" ...`);
      callback();
    }
  );

  serviceBrightnessCharacteristic.on(
    CharacteristicEventTypes.GET,
    async (callback: NodeCallback<CharacteristicValue>) => {
      debug(`Getting device named="${name}" with id="${id}" value ...`);
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
        const level = data.find(prop => prop.name === 'level');
        assert(level && level.value !== undefined, 'Missing `level.value` on data item');
        const nextValue = parseInt(`${level.value}`, 10);
        debug(`Sucessfully got device named="${name}" with id="${id}" value="${nextValue}"`);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    }
  );
};

export const updateLightbulb = (accessory: PlatformAccessory, updates: Record<string, unknown>[]) => {
  const {context} = accessory;
  const {metadata} = context;

  updateAccessorySwitchableService(accessory, updates, Service.Lightbulb);

  const levelMeta = find(metadata, {name: 'level'});
  // Not dimmable
  if (levelMeta?.step === 100) {
    return;
  }

  updates.forEach(update => {
    const {name, value} = update;
    switch (name) {
      case 'level': {
        const service = accessory.getService(Service.Lightbulb);
        assert(service, `Unexpected missing service "${Service.Lightbulb} in accessory`);
        const serviceBrightnessCharacteristic = service.getCharacteristic(Characteristic.Brightness);
        assert(serviceBrightnessCharacteristic);
        serviceBrightnessCharacteristic.updateValue(parseInt(`${value}`, 10));
        return;
      }
      default:
        return;
    }
  });
};
