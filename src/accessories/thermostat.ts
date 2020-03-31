import assert from 'assert';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicProps,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from 'hap-nodejs';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {TydomDeviceThermostatData} from 'src/typings/tydom';
import {
  addAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import {debugGet, debugGetResult, debugSet, debugSetResult} from 'src/utils/debug';
import {getTydomDeviceData, getTydomDataPropValue} from 'src/utils/tydom';

export const setupThermostat = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {displayName: name, UUID: id, context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.Thermostat, `${accessory.displayName}`, true);
  const {TargetHeatingCoolingState, CurrentHeatingCoolingState, TargetTemperature, CurrentTemperature} = Characteristic;

  service
    .getCharacteristic(CurrentHeatingCoolingState)!
    .setProps({validValues: [0, 1]} as Partial<CharacteristicProps>) // [OFF, HEAT, COOL]
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('CurrentHeatingCoolingState', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const authorization = getTydomDataPropValue<'STOP' | 'HEATING'>(data, 'authorization');
        const setpoint = getTydomDataPropValue<number>(data, 'setpoint');
        const temperature = getTydomDataPropValue<number>(data, 'temperature');
        const nextValue =
          authorization === 'HEATING' && setpoint > temperature
            ? CurrentHeatingCoolingState.HEAT
            : CurrentHeatingCoolingState.OFF;
        debugGetResult('CurrentHeatingCoolingState', {name, id, value: nextValue});
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    });

  service
    .getCharacteristic(TargetHeatingCoolingState)!
    .setProps({validValues: [0, 1]} as Partial<CharacteristicProps>) // [OFF, HEAT, COOL, AUTO]
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('TargetHeatingCoolingState', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const hvacMode = getTydomDataPropValue<'NORMAL' | 'STOP' | 'ANTI_FROST'>(data, 'hvacMode');
        const authorization = getTydomDataPropValue<'STOP' | 'HEATING'>(data, 'authorization');
        const nextValue =
          authorization === 'HEATING' && hvacMode === 'NORMAL'
            ? TargetHeatingCoolingState.HEAT
            : TargetHeatingCoolingState.OFF;
        debugGetResult('TargetHeatingCoolingState', {name, id, value: nextValue});
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('TargetHeatingCoolingState', {name, id, value});
      const nextValue = [TargetHeatingCoolingState.HEAT, TargetHeatingCoolingState.AUTO].includes(value as number)
        ? 'NORMAL'
        : 'STOP';
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'hvacMode',
          value: nextValue
        }
      ]);
      debugSetResult('TargetHeatingCoolingState', {name, id, value: nextValue});
      callback();
    });

  service
    .getCharacteristic(TargetTemperature)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('TargetTemperature', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const setpoint = getTydomDataPropValue<number>(data, 'setpoint');
        debugGetResult('TargetTemperature', {name, id, value: setpoint});
        callback(null, setpoint);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('TargetTemperature', {name, id, value});
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'setpoint',
          value: value
        }
      ]);
      debugSetResult('TargetTemperature', {name, id, value});
      callback();
    });

  service
    .getCharacteristic(CurrentTemperature)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('CurrentTemperature', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const temperature = getTydomDataPropValue<number>(data, 'temperature');
        debugGetResult('CurrentTemperature', {name, id, value: temperature});
        callback(null, temperature);
      } catch (err) {
        callback(err);
      }
    });
};

export const updateThermostat = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[]
) => {
  const {CurrentTemperature, TargetTemperature} = Characteristic;
  updates.forEach((update) => {
    const {name} = update;
    switch (name) {
      case 'setpoint': {
        const service = accessory.getService(Service.Thermostat);
        assert(service, `Unexpected missing service "${Service.Thermostat} in accessory`);
        service.getCharacteristic(TargetTemperature)!.updateValue(update!.value as number);
        return;
      }
      case 'temperature': {
        const service = accessory.getService(Service.Thermostat);
        assert(service, `Unexpected missing service "${Service.Thermostat} in accessory`);
        service.getCharacteristic(CurrentTemperature)!.updateValue(update!.value as number);
        return;
      }
      default:
        return;
    }
  });
};
