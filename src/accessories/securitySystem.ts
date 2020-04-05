import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service
} from 'hap-nodejs';
import {get} from 'lodash';
import {HOMEBRIDGE_TYDOM_PIN} from 'src/config/env';
import locale from 'src/config/locale';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {
  SecuritySystemLabelCommandResult,
  TydomDeviceSecuritySystemAlarmMode,
  TydomDeviceSecuritySystemData,
  TydomDeviceSecuritySystemZoneState
} from 'src/typings/tydom';
import {
  addAccessoryService,
  addAccessoryServiceWithSubtype,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import debug, {debugGet, debugGetResult, debugSet, debugSetResult} from 'src/utils/debug';
import {decode} from 'src/utils/hash';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/utils/tydom';

type ZoneAliases = {
  stay?: number[];
  night?: number[];
};

const {SecuritySystemTargetState, SecuritySystemCurrentState} = Characteristic;

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
  // const zones = (settings.zones || []) as string[];
  const aliases = (settings.aliases || {}) as ZoneAliases;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  const initialData = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
  const labelResults = await client.command<SecuritySystemLabelCommandResult>(
    `/devices/${deviceId}/endpoints/${endpointId}/cdata?name=label`
  );
  const {zones} = labelResults[0];

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
        const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
        const alarmMode = getTydomDataPropValue<TydomDeviceSecuritySystemAlarmMode>(data, 'alarmMode');
        const nextValue = getCurrrentStateForValue(alarmMode);
        callback(null, nextValue);
        debugGetResult('SecuritySystemCurrentState', {name, id, value: nextValue});
      } catch (err) {
        callback(err);
      }
    });
  service.getCharacteristic(SecuritySystemCurrentState)!.setValue(SecuritySystemCurrentState.DISARMED);

  service
    .getCharacteristic(SecuritySystemTargetState)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('SecuritySystemTargetState', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
        const alarmMode = getTydomDataPropValue<TydomDeviceSecuritySystemAlarmMode>(data, 'alarmMode');
        const nextValue = getTargetStateForValue(alarmMode);
        callback(null, nextValue);
        debugGetResult('SecuritySystemTargetState', {name, id, value: nextValue});
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

  // Setup global contact sensor
  const contactSensorService = addAccessoryServiceWithSubtype(
    accessory,
    Service.ContactSensor,
    get(locale, 'ALARME_ISSUES_OUVERTES', 'N/A') as string,
    `systOpenIssue`,
    true
  );
  debug(`Adding new "Service.ContactSensor" for id="${id}"`);
  contactSensorService.linkedServices = [service];
  contactSensorService
    .getCharacteristic(Characteristic.ContactSensorState)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(`systOpenIssue_On`, {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
        const systOpenIssue = getTydomDataPropValue<boolean>(data, 'systOpenIssue');
        callback(null, systOpenIssue);
      } catch (err) {
        callback(err);
      }
    });
  contactSensorService.getCharacteristic(Characteristic.Active)!.setValue(true);
  contactSensorService.getCharacteristic(Characteristic.StatusFault)!.setValue(false);

  // Setup zones switches
  for (let zoneIndex = 1; zoneIndex < 9; zoneIndex++) {
    const zoneState = getTydomDataPropValue<TydomDeviceSecuritySystemZoneState>(initialData, `zone${zoneIndex}State`);
    if (zoneState === 'UNUSED') {
      continue;
    }
    assert(zones[zoneIndex - 1], `Unexpected missing zone label data for index ${zoneIndex}`);
    const {id: productId, nameStd, nameCustom} = zones[zoneIndex - 1];
    const subDeviceId = `zone_${productId}`;
    const subDeviceName = nameCustom || `${nameStd ? (get(locale, nameStd, 'N/A') as string) : `Zone ${zoneIndex}`}`;
    const zoneService = addAccessoryServiceWithSubtype(accessory, Service.Switch, subDeviceName, subDeviceId, true);
    debug(`Adding new "Service.Switch" for name="${subDeviceName}" for id="${subDeviceId}"`);
    zoneService.linkedServices = [service];
    zoneService
      .getCharacteristic(Characteristic.On)!
      .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
        debugGet(`zone_${zoneIndex}_On`, {name, id});
        try {
          const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
          const zoneState = getTydomDataPropValue<TydomDeviceSecuritySystemZoneState>(data, `zone${zoneIndex}State`);
          callback(null, zoneState === 'ON');
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        debugSet(`zone_${zoneIndex}_On`, {name, id, value});
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

export const updateSecuritySystem = (
  accessory: PlatformAccessory,
  _controller: TydomController,
  updates: Record<string, unknown>[]
) => {
  updates.forEach((update) => {
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
        const zoneIndex = parseInt(name.match(/zone(\d+)State/)![1], 10) - 1; // @NOTE Adjust for productId starting at 0
        const subtype = `zone_${zoneIndex}`;
        const service = accessory.getServiceByUUIDAndSubType(Service.Switch, subtype);
        assert(service, `Unexpected missing service "Service.Switch" with subtype="${subtype}" in accessory`);
        service.getCharacteristic(Characteristic.On)!.updateValue(zoneState === 'ON');
        return;
      }
      case 'systOpenIssue': {
        const subtype = 'systOpenIssue';
        const service = accessory.getServiceByUUIDAndSubType(Service.ContactSensor, subtype);
        assert(service, `Unexpected missing service "Service.ContactSensor" with subtype="${subtype}" in accessory`);
        const systOpenIssue = update!.value as boolean;
        service.getCharacteristic(Characteristic.ContactSensorState)!.updateValue(systOpenIssue);
        return;
      }
      default:
        return;
    }
  });
};
