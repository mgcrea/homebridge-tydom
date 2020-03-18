import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from 'hap-nodejs';
import {HOMEBRIDGE_TYDOM_PIN} from 'src/config/env';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {
  TydomDeviceSecuritySystemAlarmMode,
  TydomDeviceSecuritySystemData,
  TydomDeviceSecuritySystemZoneState
} from 'src/typings/tydom';
import {
  addAccessoryService,
  addAccessoryServiceWithSubtype,
  getPropValue,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import {decode} from 'src/utils/buffer';
import debug, {debugGet, debugSet, debugSetResult} from 'src/utils/debug';
import {getTydomDeviceData} from 'src/utils/tydom';

type ZoneAliases = {
  stay?: number[];
  night?: number[];
};

const {SecuritySystemTargetState, SecuritySystemCurrentState} = Characteristic;

const zoneServices = new Map<number, Service>();

const getCurrrentStateForValue = (alarmMode: TydomDeviceSecuritySystemAlarmMode): number => {
  if (alarmMode === 'ON') {
    return SecuritySystemCurrentState.AWAY_ARM;
  }
  if (alarmMode === 'ZONE') {
    return SecuritySystemCurrentState.NIGHT_ARM;
  }
  return SecuritySystemCurrentState.DISARMED;
};

const getTargetStateForValue = (alarmMode: TydomDeviceSecuritySystemAlarmMode): number => {
  if (alarmMode === 'ON') {
    return SecuritySystemTargetState.AWAY_ARM;
  }
  if (alarmMode === 'ZONE') {
    return SecuritySystemTargetState.NIGHT_ARM;
  }
  return SecuritySystemTargetState.DISARM;
};

export const setupSecuritySystem = async (accessory: PlatformAccessory, controller: TydomController): Promise<void> => {
  const {displayName: name, UUID: id, context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId, settings} = context;
  const aliases = (settings.aliases || {}) as ZoneAliases;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.SecuritySystem, `${accessory.displayName}`, true);
  const pin = HOMEBRIDGE_TYDOM_PIN ? decode(HOMEBRIDGE_TYDOM_PIN) : settings.pin;
  if (!pin) {
    controller.log.warn(
      `Missing pin for device securitySystem, add either {"settings": {"${deviceId}": {"pin": "123456"}}} or HOMEBRIDGE_TYDOM_PIN env var (base64 encoded)`
    );
  }

  service
    .getCharacteristic(SecuritySystemCurrentState)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('SecuritySystemCurrentState', {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
        const alarmMode = getPropValue<TydomDeviceSecuritySystemAlarmMode>(data, 'alarmMode');
        callback(null, getCurrrentStateForValue(alarmMode));
      } catch (err) {
        callback(err);
      }
    });

  service
    .getCharacteristic(SecuritySystemTargetState)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('SecuritySystemTargetState', {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
        const alarmMode = getPropValue<TydomDeviceSecuritySystemAlarmMode>(data, 'alarmMode');
        callback(null, getTargetStateForValue(alarmMode));
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet('SecuritySystemTargetState', {name, id, value});
      if (!pin) {
        callback(null);
        return;
      }
      if ([SecuritySystemTargetState.AWAY_ARM, SecuritySystemTargetState.DISARM].includes(value as number)) {
        const nextValue = value === SecuritySystemTargetState.DISARM ? 'OFF' : 'ON';
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/cdata?name=alarmCmd`, {
          value: nextValue,
          pwd: pin
        });
        debugSetResult('SecuritySystemTargetState', {name, id, value: nextValue});
      }
      if ([SecuritySystemTargetState.STAY_ARM, SecuritySystemTargetState.NIGHT_ARM].includes(value as number)) {
        const nextValue = value === SecuritySystemTargetState.DISARM ? 'OFF' : 'ON';
        const targetZones = value === SecuritySystemTargetState.STAY_ARM ? aliases.stay : aliases.night;
        if (Array.isArray(targetZones) && targetZones.length > 0) {
          await client.put(`/devices/${deviceId}/endpoints/${endpointId}/cdata?name=zoneCmd`, {
            value: nextValue,
            pwd: pin,
            zones: targetZones
          });
        }
        debugSetResult('SecuritySystemTargetState', {name, id, value: nextValue});
      }
      callback(null);
    });

  const initialData = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
  for (let zoneIndex = 1; zoneIndex < 9; zoneIndex++) {
    const zoneState = getPropValue<TydomDeviceSecuritySystemZoneState>(initialData, `zone${zoneIndex}State`);
    if (zoneState === 'UNUSED') {
      continue;
    }
    const zoneService = addAccessoryServiceWithSubtype(
      accessory,
      Service.Switch,
      `Zone ${zoneIndex}`,
      `zone_${zoneIndex}`,
      true
    );
    debug(`Adding new Service.Switch for zoneIndex="${zoneIndex}" for id="${id}"`);
    zoneServices.set(zoneIndex, zoneService);
    zoneService.linkedServices = [service];
    zoneService
      .getCharacteristic(Characteristic.On)!
      .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
        debugGet(`Zone_${zoneIndex}_On`, {name, id});
        try {
          const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
          const zoneState = getPropValue<TydomDeviceSecuritySystemZoneState>(data, `zone${zoneIndex}State`);
          callback(null, zoneState === 'ON');
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        debugSet(`Zone_${zoneIndex}_On`, {name, id, value});
        if (!pin) {
          callback(null);
          return;
        }
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/cdata?name=zoneCmd`, {
          value: value ? 'ON' : 'OFF',
          pwd: pin,
          zones: [zoneIndex]
        });
        callback(null);
      });
  }
};

export const updateSecuritySystem = (accessory: PlatformAccessory, updates: Record<string, unknown>[]) => {
  updates.forEach(update => {
    const {name} = update;
    switch (name) {
      case 'alarmMode': {
        const service = accessory.getService(Service.SecuritySystem);
        assert(service, `Unexpected missing service "Service.SecuritySystem" in accessory`);
        const alarmMode = update!.value as TydomDeviceSecuritySystemAlarmMode;
        service.getCharacteristic(SecuritySystemCurrentState)!.updateValue(getCurrrentStateForValue(alarmMode));
        service.getCharacteristic(SecuritySystemTargetState)!.updateValue(getTargetStateForValue(alarmMode));
        return;
      }
      case 'zone1State':
      case 'zone2State':
      case 'zone3State':
      case 'zone4State':
      case 'zone5State':
      case 'zone6State':
      case 'zone7State':
      case 'zone8State': {
        const zoneState = update!.value as TydomDeviceSecuritySystemZoneState;
        if (zoneState === 'UNUSED') {
          return;
        }
        const zoneIndex = parseInt(name.match(/zone(\d+)State/)![1], 10);
        const service = zoneServices.get(zoneIndex);
        assert(service, `Unexpected missing service "Zone ${zoneIndex}" in accessory`);
        service.getCharacteristic(Characteristic.On)!.updateValue(zoneState === 'ON');
        return;
      }
      default:
        return;
    }
  });
};

/*
{
  "name": "alarmState",
  "type": "string",
  "permission": "r",
  "enum_values": ["OFF", "DELAYED", "ON", "QUIET"]
},
{
  "name": "alarmMode",
  "type": "string",
  "permission": "r",
  "enum_values": ["OFF", "ON", "TEST", "ZONE", "MAINTENANCE"]
}
*/
