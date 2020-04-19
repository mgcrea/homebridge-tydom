import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicProps,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from 'hap-nodejs';
import {get} from 'lodash';
import locale from 'src/config/locale';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {
  TydomDeviceThermostatAuthorization,
  TydomDeviceThermostatData,
  TydomDeviceThermostatHvacMode,
  TydomDeviceThermostatThermicLevel
} from 'src/typings/tydom';
import {
  addAccessoryService,
  addAccessoryServiceWithSubtype,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import {chalkKeyword, chalkString} from 'src/utils/chalk';
import debug, {debugGet, debugGetResult, debugSet, debugSetResult} from 'src/utils/debug';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/utils/tydom';

const {TargetHeatingCoolingState, CurrentHeatingCoolingState, TargetTemperature, CurrentTemperature} = Characteristic;

export const setupThermostat = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {displayName: name, UUID: id, context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId, metadata} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.Thermostat, `${accessory.displayName}`, true);

  service
    .getCharacteristic(CurrentHeatingCoolingState)!
    .setProps({validValues: [0, 1]} as Partial<CharacteristicProps>) // [OFF, HEAT, COOL]
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('CurrentHeatingCoolingState', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const authorization = getTydomDataPropValue<TydomDeviceThermostatAuthorization>(data, 'authorization');
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
        const hvacMode = getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, 'hvacMode');
        const authorization = getTydomDataPropValue<'STOP' | 'HEATING'>(data, 'authorization');
        const nextValue =
          authorization === 'HEATING' && ['NORMAL'].includes(hvacMode)
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
      callback(null, value);
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
      callback(null, value);
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

  const thermicLevelValues = metadata.find(({name}) => name === 'thermicLevel')!.enum_values as string[];

  // Only absence (aka. anti-frost) mode
  if (thermicLevelValues.length === 1) {
    const absenceModeId = `hvacMode_absence`;
    const absenceModeName = get(locale, 'HVAC_INFO_ABSENCE', 'N/A') as string;
    const absenceModeService = addAccessoryServiceWithSubtype(
      accessory,
      Service.Switch,
      absenceModeName,
      absenceModeId,
      true
    );
    debug(
      `Adding new ${chalkKeyword('Service.Switch')} with name=${chalkString(absenceModeName)} and id="${chalkString(
        absenceModeId
      )}"`
    );
    absenceModeService.linkedServices = [service];
    absenceModeService
      .getCharacteristic(Characteristic.On)!
      .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
        debugGet(`absenceMode_On`, {name, id});
        try {
          const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
          const hvacMode = getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, 'hvacMode');
          // const antifrostOn = getTydomDataPropValue<boolean>(data, 'antifrostOn');
          // const nextValue = hvacMode === 'ANTI_FROST' && antifrostOn;
          const nextValue = hvacMode === 'ANTI_FROST';
          debugGetResult(`absenceMode_On`, {name, id, value: nextValue});
          callback(null, nextValue);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        debugSet(`absenceMode_On`, {name, id, value});
        const nextValue = value ? 'ANTI_FROST' : 'STOP';
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
          {
            name: 'hvacMode',
            value: nextValue
          }
        ]);
        debugSetResult(`absenceMode_On`, {name, id, value: nextValue});
        callback(null, value);
      });
  }

  // Multiple thermic levels
  if (thermicLevelValues.length > 1) {
    thermicLevelValues.forEach((thermicLevelValue) => {
      if (['MODERATO', 'MEDIO', 'STOP'].includes(thermicLevelValue)) {
        return;
      }
      // Setup anti-frost switch
      const thermicLevelId = `thermicLevel_${thermicLevelValue.toLowerCase()}`;
      const thermicLevelName = get(locale, `HVAC_LEVEL_${thermicLevelValue}`, 'N/A') as string;
      const thermicLevelService = addAccessoryServiceWithSubtype(
        accessory,
        Service.Switch,
        thermicLevelName,
        thermicLevelId,
        true
      );
      debug(
        `Adding new ${chalkKeyword('Service.Switch')} with name=${chalkString(thermicLevelName)} and id="${chalkString(
          thermicLevelId
        )}"`
      );
      thermicLevelService.linkedServices = [service];
      thermicLevelService
        .getCharacteristic(Characteristic.On)!
        .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
          debugGet(`${thermicLevelId}_On`, {name, id});
          try {
            const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
            const thermicLevel = getTydomDataPropValue<TydomDeviceThermostatThermicLevel>(data, 'thermicLevel');
            const nextValue = thermicLevel === thermicLevelValue;
            debugGetResult(`${thermicLevelId}_On`, {name, id, value: nextValue});
            callback(null, nextValue);
          } catch (err) {
            callback(err);
          }
        })
        .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          debugSet(`${thermicLevelId}_On`, {name, id, value});
          const nextValue = value ? thermicLevelValue : 'STOP';
          await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
            {
              name: 'hvacMode',
              value: nextValue
            }
          ]);
          debugSetResult(`${thermicLevelId}_On`, {name, id, value: nextValue});
          callback(null, value);
        });
    });
  }
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
      case 'authorization': {
        const service = accessory.getService(Service.Thermostat);
        assert(service, `Unexpected missing service "Service.Thermostat" in accessory`);
        const authorization = update!.value as TydomDeviceThermostatAuthorization;
        if (authorization === 'HEATING') {
          // @TODO Trigger a get as we miss info
          return;
        }
        if (authorization === 'STOP') {
          service.getCharacteristic(CurrentHeatingCoolingState)!.updateValue(CurrentHeatingCoolingState.OFF);
          // External update probably comes from the Tydom app, let's agree on the target state
          service.getCharacteristic(TargetHeatingCoolingState)!.updateValue(TargetHeatingCoolingState.OFF);
          return;
        }
      }
      case 'hvacMode': {
        const service = accessory.getService(Service.Thermostat);
        assert(service, `Unexpected missing service "Service.Thermostat" in accessory`);
        const hvacMode = update!.value as TydomDeviceThermostatHvacMode;
        if (hvacMode === 'NORMAL') {
          // @TODO Trigger a get as we miss info
          return;
        }
        service.getCharacteristic(TargetHeatingCoolingState)!.updateValue(CurrentHeatingCoolingState.OFF);
        if (hvacMode === 'ANTI_FROST') {
          const subtype = 'hvacMode_absence';
          const service = accessory.getServiceByUUIDAndSubType(Service.Switch, subtype);
          if (service) {
            service.getCharacteristic(Characteristic.On)!.updateValue(true);
            return;
          }
        }
      }
      case 'thermicLevel': {
        const thermicLevel = update!.value as TydomDeviceThermostatThermicLevel;
        if (thermicLevel === null) {
          debug(`Encountered a ${chalkString('thermicLevel')} update with a null value!`);
          return;
        }
        const service = accessory.getServiceByUUIDAndSubType(
          Service.Switch,
          `thermicLevel_${thermicLevel.toLowerCase()}`
        );
        if (service) {
          service.getCharacteristic(Characteristic.On)!.updateValue(true);
          return;
        }
      }
      // case 'antifrostOn': {
      //   const subtype = 'antifrostOn';
      //   const service = accessory.getServiceByUUIDAndSubType(Service.Switch, subtype);
      //   assert(service, `Unexpected missing service "Service.Switch" with subtype="${subtype}" in accessory`);
      //   const antifrostOn = update!.value as boolean;
      //   service.getCharacteristic(Characteristic.On)!.updateValue(antifrostOn);
      //   return;
      // }
      case 'setpoint': {
        const setpoint = update!.value as number;
        if (setpoint === null) {
          debug(`Encountered a ${chalkString('setpoint')} update with a null value!`);
          return;
        }
        const service = accessory.getService(Service.Thermostat);
        assert(service, `Unexpected missing service "Service.Thermostat" in accessory`);
        service.getCharacteristic(TargetTemperature)!.updateValue(setpoint);
        return;
      }
      case 'temperature': {
        const service = accessory.getService(Service.Thermostat);
        assert(service, `Unexpected missing service "Service.Thermostat" in accessory`);
        service.getCharacteristic(CurrentTemperature)!.updateValue(update!.value as number);
        return;
      }
      default:
        return;
    }
  });
};

// OFF -> authorization === STOP
// ANTI_FROST -> hvacMode === ANTI_FROST
// CHAUFFAGE -> authorization === HEATING
