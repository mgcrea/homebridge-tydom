import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from 'hap-nodejs';
import {find, debounce} from 'lodash';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {TydomEndpointData} from 'src/typings/tydom';
import {
  addAccessoryService,
  asNumber,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import {debugGet, debugGetResult, debugSet, debugSetResult} from 'src/utils/debug';
import {getTydomDeviceData} from 'src/utils/tydom';
import {addAccessorySwitchableService, updateAccessorySwitchableService} from './services/switchableService';

export const setupLightbulb = (accessory: PlatformAccessory, controller: TydomController): void => {
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service

  const {displayName: name, UUID: id, context} = accessory;
  const {deviceId, endpointId, metadata} = context;
  const {client} = controller;
  const levelMeta = find(metadata, {name: 'level'});

  // Not dimmable
  if (levelMeta?.step === 100) {
    addAccessorySwitchableService(accessory, controller, Service.Lightbulb);
    return;
  }

  // Dimmable
  const service = addAccessoryService(accessory, Service.Lightbulb, `${accessory.displayName}`, true);
  const serviceOnCharacteristic = service.getCharacteristic(Characteristic.On);
  assert(serviceOnCharacteristic);
  const serviceBrightnessCharacteristic = service.getCharacteristic(Characteristic.Brightness);
  assert(serviceBrightnessCharacteristic);

  const debouncedSetLevel = debounce(async (value: number) => {
    await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
      {
        name: 'level',
        value
      }
    ]);
  }, 15);

  serviceOnCharacteristic.on(
    CharacteristicEventTypes.SET,
    async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('On', {name, id, value});
      if (typeof value === 'boolean') {
        const nextValue = value ? (serviceBrightnessCharacteristic.value as number) || 100 : 0;
        await debouncedSetLevel(nextValue);
        debugSetResult('On', {name, id, value: nextValue});
      }
      callback();
    }
  );

  serviceOnCharacteristic.on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
    debugGet('On', {name, id});
    try {
      const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
      const level = data.find(prop => prop.name === 'level');
      assert(level && level.value !== undefined, 'Missing `level.value` on data item');
      const nextValue = level.value > 0;
      debugGetResult('On', {name, id, value: nextValue});
      callback(null, nextValue);
    } catch (err) {
      callback(err);
    }
  });

  serviceBrightnessCharacteristic.on(
    CharacteristicEventTypes.SET,
    async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('Brightness', {name, id, value});
      const nextValue = asNumber(value);
      await debouncedSetLevel(nextValue);
      debugSetResult('Brightness', {name, id, value: nextValue});
      callback();
    }
  );

  serviceBrightnessCharacteristic.on(
    CharacteristicEventTypes.GET,
    async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('Brightness', {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomEndpointData;
        const level = data.find(prop => prop.name === 'level');
        assert(level && level.value !== undefined, 'Missing `level.value` on data item');
        const nextValue = asNumber(level.value);
        debugGetResult('Brightness', {name, id, value: nextValue});
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
  const levelMeta = find(metadata, {name: 'level'});
  // Not dimmable
  if (levelMeta?.step === 100) {
    updateAccessorySwitchableService(accessory, updates, Service.Lightbulb);
    return;
  }
  // Dimmable
  updates.forEach(update => {
    const {name, value} = update;
    switch (name) {
      case 'level': {
        const service = accessory.getService(Service.Lightbulb);
        assert(service, `Unexpected missing service "${Service.Lightbulb} in accessory`);
        const valueAsNumber = asNumber(value);
        const serviceOnCharacteristic = service.getCharacteristic(Characteristic.On);
        assert(serviceOnCharacteristic);
        serviceOnCharacteristic.updateValue(valueAsNumber > 0);
        const serviceBrightnessCharacteristic = service.getCharacteristic(Characteristic.Brightness);
        assert(serviceBrightnessCharacteristic);
        serviceBrightnessCharacteristic.updateValue(valueAsNumber);
        return;
      }
      default:
        return;
    }
  });
};
