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
import {debugGet, debugSet} from 'src/utils/debug';
import {getTydomDeviceData} from 'src/utils/tydom';

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
    // @ts-ignore
    .setProps({validValues: [0, 1]} as Partial<CharacteristicProps>) // [OFF, HEAT, COOL]
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('CurrentHeatingCoolingState', {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceThermostatData;
        // const hvacMode = data.find(prop => prop.name === 'hvacMode');
        const authorization = data.find((prop) => prop.name === 'authorization')!.value;
        const setpoint = data.find((prop) => prop.name === 'setpoint')!.value;
        const temperature = data.find((prop) => prop.name === 'temperature')!.value;
        callback(
          null,
          authorization === 'HEATING' && setpoint > temperature
            ? CurrentHeatingCoolingState.HEAT
            : CurrentHeatingCoolingState.OFF
        );
      } catch (err) {
        callback(err);
      }
    });

  service
    .getCharacteristic(TargetHeatingCoolingState)!
    // @ts-ignore
    .setProps({validValues: [0, 1]} as Partial<CharacteristicProps>) // [OFF, HEAT, COOL, AUTO]
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('TargetHeatingCoolingState', {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceThermostatData;
        const hvacMode = data.find((prop) => prop.name === 'hvacMode')!.value; // NORMAL | STOP | ANTI_FROST
        const authorization = data.find((prop) => prop.name === 'authorization')!.value; // STOP | HEATING
        callback(
          null,
          authorization === 'HEATING' && hvacMode === 'NORMAL'
            ? TargetHeatingCoolingState.HEAT
            : TargetHeatingCoolingState.OFF
        );
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('TargetHeatingCoolingState', {name, id, value});
      const tydomValue = [TargetHeatingCoolingState.HEAT, TargetHeatingCoolingState.AUTO].includes(value as number)
        ? 'NORMAL'
        : 'STOP';
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: 'hvacMode',
          value: tydomValue
        }
      ]);
      callback();
    });

  service
    .getCharacteristic(TargetTemperature)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('TargetTemperature', {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceThermostatData;
        const setpoint = data.find((prop) => prop.name === 'setpoint');
        assert(setpoint, 'Missing `setpoint` data item');
        callback(null, setpoint!.value);
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
      callback();
    });

  service
    .getCharacteristic(CurrentTemperature)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('CurrentTemperature', {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceThermostatData;
        const temperature = data.find((prop) => prop.name === 'temperature');
        assert(temperature, 'Missing `temperature` data item');
        callback(null, temperature!.value);
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
