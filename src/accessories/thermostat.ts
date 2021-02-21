import type {PlatformAccessory} from 'homebridge';
import {get} from 'lodash';
import locale from '../config/locale';
import TydomController from '../controller';
import type {
  TydomAccessoryContext,
  TydomDeviceThermostatAuthorization,
  TydomDeviceThermostatData,
  TydomDeviceThermostatHvacMode,
  TydomDeviceThermostatThermicLevel
} from '../typings/tydom';
import {
  addAccessoryService,
  addAccessoryServiceWithSubtype,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from '../utils/accessory';
import {chalkString} from '../utils/chalk';
import debug, {
  debugAddSubService,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate
} from '../utils/debug';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicProps,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from '../utils/hap';
import {getTydomDataPropValue, getTydomDeviceData} from '../utils/tydom';

export const setupThermostat = (accessory: PlatformAccessory, controller: TydomController): void => {
  const {context} = accessory;
  const {client} = controller;
  const {
    TargetHeatingCoolingState,
    CurrentHeatingCoolingState,
    TargetTemperature,
    CurrentTemperature,
    On
  } = Characteristic;

  const {deviceId, endpointId, metadata} = context as TydomAccessoryContext;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.Thermostat, `${accessory.displayName}`, true);

  service
    .getCharacteristic(CurrentHeatingCoolingState)
    .setProps({validValues: [0, 1]} as Partial<CharacteristicProps>) // [OFF, HEAT, COOL]
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(CurrentHeatingCoolingState, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const authorization = getTydomDataPropValue<TydomDeviceThermostatAuthorization>(data, 'authorization');
        const setpoint = getTydomDataPropValue<number>(data, 'setpoint');
        const temperature = getTydomDataPropValue<number>(data, 'temperature');
        const nextValue =
          authorization === 'HEATING' && setpoint > temperature
            ? CurrentHeatingCoolingState.HEAT
            : CurrentHeatingCoolingState.OFF;
        debugGetResult(CurrentHeatingCoolingState, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .getValue();

  service
    .getCharacteristic(TargetHeatingCoolingState)
    .setProps({validValues: [0, 1]} as Partial<CharacteristicProps>) // [OFF, HEAT, COOL, AUTO]
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(TargetHeatingCoolingState, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const hvacMode = getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, 'hvacMode');
        const authorization = getTydomDataPropValue<'STOP' | 'HEATING'>(data, 'authorization');
        const nextValue =
          authorization === 'HEATING' && ['NORMAL'].includes(hvacMode)
            ? TargetHeatingCoolingState.HEAT
            : TargetHeatingCoolingState.OFF;
        debugGetResult(TargetHeatingCoolingState, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(TargetHeatingCoolingState, service, value);
      try {
        const shouldHeat = [TargetHeatingCoolingState.HEAT, TargetHeatingCoolingState.AUTO].includes(value as number);
        const tydomValue = shouldHeat ? 'NORMAL' : 'STOP';
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
          {
            name: 'hvacMode',
            value: tydomValue
          }
        ]);
        debugSetResult(TargetHeatingCoolingState, service, value, tydomValue);
        // @NOTE directly update currentHeadingCoolingState
        service
          .getCharacteristic(CurrentHeatingCoolingState)
          .updateValue(shouldHeat ? CurrentHeatingCoolingState.HEAT : CurrentHeatingCoolingState.OFF);
        callback();
      } catch (err) {
        callback(err);
      }
    });

  service
    .getCharacteristic(CurrentTemperature)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(CurrentTemperature, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const temperature = getTydomDataPropValue<number>(data, 'temperature');
        debugGetResult(CurrentTemperature, service, temperature);
        callback(null, temperature);
      } catch (err) {
        callback(err);
      }
    })
    .getValue();

  service
    .getCharacteristic(TargetTemperature)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(TargetTemperature, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
        const setpoint = getTydomDataPropValue<number>(data, 'setpoint');
        debugGetResult(TargetTemperature, service, setpoint);
        callback(null, setpoint);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      try {
        debugSet(TargetTemperature, service, value);
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
          {
            name: 'setpoint',
            value: value
          }
        ]);
        debugSetResult(TargetTemperature, service, value);
        callback();
      } catch (err) {
        callback(err);
      }
    });

  const thermicLevelData = metadata.find(({name}) => name === 'thermicLevel');
  if (!thermicLevelData) {
    controller.log.error(
      `Failed to properly create the thermostat accesory for device ${deviceId}, did not found object in array that matches {"name": "thermicLevel"} in ${JSON.stringify(
        metadata
      )}`
    );
    return;
  }
  const thermicLevelValues = thermicLevelData.enum_values as string[];

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
    debugAddSubService(absenceModeService, accessory);
    service.addLinkedService(absenceModeService);
    absenceModeService
      .getCharacteristic(On)
      .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
        debugGet(On, absenceModeService);
        try {
          const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
          const hvacMode = getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, 'hvacMode');
          // const antifrostOn = getTydomDataPropValue<boolean>(data, 'antifrostOn');
          // const nextValue = hvacMode === 'ANTI_FROST' && antifrostOn;
          const nextValue = hvacMode === 'ANTI_FROST';
          debugGetResult(On, absenceModeService, nextValue);
          callback(null, nextValue);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        debugSet(On, absenceModeService, value);
        try {
          const tydomValue = value ? 'ANTI_FROST' : 'NORMAL';
          await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
            {
              name: 'hvacMode',
              value: tydomValue
            }
          ]);
          debugSetResult(On, absenceModeService, value, tydomValue);
          callback();
        } catch (err) {
          callback(err);
        }
      });
  }

  // Multiple thermic levels
  // "enum_values": ["ECO", "MODERATO", "MEDIO", "COMFORT", "STOP", "ANTI_FROST"]
  if (thermicLevelValues.length > 1) {
    const THERMIC_LEVELS_WHITELIST = ['ANTI_FROST', 'ECO', 'COMFORT'];
    const thermicLevelServices = thermicLevelValues
      .filter((value) => THERMIC_LEVELS_WHITELIST.includes(value))
      .map((thermicLevelValue) => {
        const thermicLevelId = `thermicLevel_${thermicLevelValue.toLowerCase()}`;
        const thermicLevelName = get(locale, `HVAC_LEVEL_${thermicLevelValue}`, 'N/A') as string;
        const thermicLevelService = addAccessoryServiceWithSubtype(
          accessory,
          Service.Switch,
          thermicLevelName,
          thermicLevelId,
          true
        );
        debugAddSubService(thermicLevelService, accessory);
        service.addLinkedService(thermicLevelService);
        thermicLevelService
          .getCharacteristic(On)
          .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
            debugGet(On, thermicLevelService);
            try {
              const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {deviceId, endpointId});
              const thermicLevel = getTydomDataPropValue<TydomDeviceThermostatThermicLevel>(data, 'thermicLevel');
              const nextValue = thermicLevel === thermicLevelValue;
              debugGetResult(On, thermicLevelService, nextValue);
              callback(null, nextValue);
            } catch (err) {
              callback(err);
            }
          })
          .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            debugSet(On, thermicLevelService, value);
            try {
              const tydomValue = value ? thermicLevelValue : 'NORMAL';
              await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
                {
                  name: 'hvacMode',
                  value: tydomValue
                }
              ]);
              debugSetResult(On, thermicLevelService, tydomValue);
              callback();
              // @NOTE disable any other existing thermicLevel
              thermicLevelServices
                .filter(({value}) => value !== thermicLevelValue)
                .forEach(({service}) => {
                  service.updateCharacteristic(On, false);
                });
            } catch (err) {
              callback(err);
            }
          });
        return {value: thermicLevelValue, service: thermicLevelService};
      });
  }
};

export const updateThermostat = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[]
): void => {
  const {
    TargetHeatingCoolingState,
    CurrentHeatingCoolingState,
    TargetTemperature,
    CurrentTemperature,
    On
  } = Characteristic;

  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'authorization': {
        const service = getAccessoryService(accessory, Service.Thermostat);
        const authorization = value as TydomDeviceThermostatAuthorization;
        if (authorization === 'HEATING') {
          // @TODO Trigger a get as we miss info
          return;
        }
        if (authorization === 'STOP') {
          debugSetUpdate(CurrentHeatingCoolingState, service, CurrentHeatingCoolingState.OFF);
          service.updateCharacteristic(CurrentHeatingCoolingState, CurrentHeatingCoolingState.OFF);
          // External update probably comes from the Tydom app, let's agree on the target state
          debugSetUpdate(TargetHeatingCoolingState, service, TargetHeatingCoolingState.OFF);
          service.updateCharacteristic(TargetHeatingCoolingState, TargetHeatingCoolingState.OFF);
          return;
        }
        return;
      }
      case 'hvacMode': {
        const service = getAccessoryService(accessory, Service.Thermostat);
        const hvacMode = value as TydomDeviceThermostatHvacMode;
        if (hvacMode === 'NORMAL') {
          // @TODO Trigger a get as we miss info
          return;
        }
        service.updateCharacteristic(TargetHeatingCoolingState, CurrentHeatingCoolingState.OFF);
        if (hvacMode === 'ANTI_FROST') {
          const subtype = 'hvacMode_absence';
          const service = accessory.getServiceByUUIDAndSubType(Service.Switch, subtype);
          if (service) {
            debugSetUpdate(On, service, true);
            service.updateCharacteristic(On, true);
            return;
          }
        }
        return;
      }
      case 'thermicLevel': {
        const thermicLevel = value as TydomDeviceThermostatThermicLevel;
        if (thermicLevel === null) {
          debug(`Encountered a ${chalkString('thermicLevel')} update with a null value!`);
          return;
        }
        const service = accessory.getServiceByUUIDAndSubType(
          Service.Switch,
          `thermicLevel_${thermicLevel.toLowerCase()}`
        );
        if (service) {
          debugSetUpdate(On, service, true);
          service.updateCharacteristic(On, true);
          return;
        }
        return;
      }
      // case 'antifrostOn': {
      //   const subtype = 'antifrostOn';
      //   const service = accessory.getServiceByUUIDAndSubType(Service.Switch, subtype);
      //   assert(service, `Unexpected missing service "Service.Switch" with subtype="${subtype}" in accessory`);
      //   const antifrostOn = value as boolean;
      //   service.updateCharacteristic(Characteristic, antifrostOn);
      //   return;
      // }
      case 'setpoint': {
        const setpoint = value as number;
        if (setpoint === null) {
          debug(`Encountered a ${chalkString('setpoint')} update with a null value!`);
          return;
        }
        const service = getAccessoryService(accessory, Service.Thermostat);
        debugSetUpdate(TargetTemperature, service, setpoint);
        service.updateCharacteristic(TargetTemperature, setpoint);
        return;
      }
      case 'temperature': {
        const service = getAccessoryService(accessory, Service.Thermostat);
        debugSetUpdate(CurrentTemperature, service, value);
        service.updateCharacteristic(CurrentTemperature, value as number);
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
