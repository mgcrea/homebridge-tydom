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
  TydomDeviceSecuritySystemZoneState,
  TydomDeviceSecuritySystemAlarmState
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
import {chalkKeyword, chalkString} from 'src/utils/chalk';

type ZoneAliases = {
  stay?: number[];
  night?: number[];
};

const {SecuritySystemTargetState, SecuritySystemCurrentState, StatusTampered} = Characteristic;

const getCurrrentStateForValue = (
  alarmState: TydomDeviceSecuritySystemAlarmState,
  alarmMode: TydomDeviceSecuritySystemAlarmMode
): number => {
  if (['DELAYED', 'ON', 'QUIET'].includes(alarmState)) {
    return SecuritySystemCurrentState.ALARM_TRIGGERED;
  }
  if (alarmMode === 'ON') {
    return SecuritySystemCurrentState.AWAY_ARM;
  }
  if (alarmMode === 'ZONE') {
    // @TODO properly match with defined zones aliases
    return SecuritySystemCurrentState.NIGHT_ARM;
  }
  return SecuritySystemCurrentState.DISARMED;
};

const getTargetStateForValue = (alarmMode: TydomDeviceSecuritySystemAlarmMode): number => {
  if (alarmMode === 'ON') {
    return SecuritySystemTargetState.AWAY_ARM;
  }
  if (alarmMode === 'ZONE') {
    // @TODO properly match with defined zones aliases
    return SecuritySystemTargetState.NIGHT_ARM;
  }
  return SecuritySystemTargetState.DISARM;
};

// const getTydomZonesValues = (data: TydomDeviceSecuritySystemData): unknown => {
// };

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
    .setValue(SecuritySystemCurrentState.DISARMED) // Default to disarmed to prevent notifications
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('SecuritySystemCurrentState', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
        const alarmState = getTydomDataPropValue<TydomDeviceSecuritySystemAlarmState>(data, 'alarmState');
        const alarmMode = getTydomDataPropValue<TydomDeviceSecuritySystemAlarmMode>(data, 'alarmMode');
        const nextValue = getCurrrentStateForValue(alarmState, alarmMode);
        callback(null, nextValue);
        debugGetResult('SecuritySystemCurrentState', {name, id, value: nextValue});
      } catch (err) {
        callback(err);
      }
    });

  service
    .getCharacteristic(StatusTampered)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet('StatusTampered', {name, id});
      try {
        const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
        const systAutoProtect = getTydomDataPropValue<boolean>(data, 'systAutoProtect');
        callback(null, systAutoProtect);
        debugGetResult('StatusTampered', {name, id, value: systAutoProtect});
      } catch (err) {
        callback(err);
      }
    });

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
  const systOpenIssueId = `systOpenIssue`;
  const systOpenIssueName = get(locale, 'ALARME_ISSUES_OUVERTES', 'N/A') as string;
  const systOpenIssueService = addAccessoryServiceWithSubtype(
    accessory,
    Service.ContactSensor,
    systOpenIssueName,
    systOpenIssueId,
    true
  );
  debug(
    `Adding new ${chalkKeyword('Service.ContactSensor')} with name=${chalkString(
      systOpenIssueName
    )} and id="${chalkString(systOpenIssueId)}"`
  );
  systOpenIssueService.linkedServices = [service];
  systOpenIssueService
    .getCharacteristic(Characteristic.ContactSensorState)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(`systOpenIssue_On`, {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
        const systOpenIssue = getTydomDataPropValue<boolean>(data, 'systOpenIssue');
        debugGetResult('systOpenIssue_On', {name, id, value: systOpenIssue});
        callback(null, systOpenIssue);
      } catch (err) {
        callback(err);
      }
    });
  systOpenIssueService.getCharacteristic(Characteristic.StatusActive)!.setValue(true);
  systOpenIssueService.getCharacteristic(Characteristic.StatusFault)!.setValue(false);

  // Setup global contact sensor
  const alarmSOSId = `alarmSOS`;
  const alarmSOSName = get(locale, 'DISCRETE_ALARM_V3', 'N/A') as string;
  const alarmSOSService = addAccessoryServiceWithSubtype(
    accessory,
    Service.ContactSensor,
    alarmSOSName,
    alarmSOSId,
    true
  );
  debug(
    `Adding new ${chalkKeyword('Service.ContactSensor')} with name=${chalkString(alarmSOSName)} and id="${chalkString(
      alarmSOSId
    )}"`
  );
  alarmSOSService.linkedServices = [service];
  alarmSOSService
    .getCharacteristic(Characteristic.ContactSensorState)!
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(`alarmSOS_On`, {name, id});
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
        const alarmSOS = getTydomDataPropValue<boolean>(data, 'alarmSOS');
        debugGetResult('alarmSOS_On', {name, id, value: alarmSOS});
        callback(null, alarmSOS);
      } catch (err) {
        callback(err);
      }
    });
  alarmSOSService.getCharacteristic(Characteristic.StatusActive)!.setValue(true);
  alarmSOSService.getCharacteristic(Characteristic.StatusFault)!.setValue(false);

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
    debug(
      `Adding new ${chalkKeyword('Service.Switch')} with name=${chalkString(subDeviceName)} and id="${chalkString(
        subDeviceId
      )}"`
    );
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
  // Process alarmState/alarmMode together
  if (updates.some(({name}) => name === 'alarmState') && updates.some(({name}) => name === 'alarmMode')) {
    const alarmState = updates.find(({name}) => name === 'alarmState')!.value as TydomDeviceSecuritySystemAlarmState;
    const alarmMode = updates.find(({name}) => name === 'alarmMode')!.value as TydomDeviceSecuritySystemAlarmMode;
    const service = accessory.getService(Service.SecuritySystem);
    assert(service, `Unexpected missing service "Service.SecuritySystem" in accessory`);
    const currentState = getCurrrentStateForValue(alarmState, alarmMode);
    service.getCharacteristic(SecuritySystemCurrentState)!.updateValue(currentState);
    if (currentState !== SecuritySystemCurrentState.ALARM_TRIGGERED) {
      // External update probably comes from the Tydom app, let's agree on the target state
      service.getCharacteristic(SecuritySystemTargetState)!.updateValue(getTargetStateForValue(alarmMode));
    }
  }

  updates.forEach((update) => {
    const {name} = update;
    switch (name) {
      case 'alarmState':
      case 'alarmMode': {
        // Handled above
        return;
      }
      case 'alarmSOS': {
        const subtype = 'alarmSOS';
        const service = accessory.getServiceByUUIDAndSubType(Service.ContactSensor, subtype);
        assert(service, `Unexpected missing service "Service.ContactSensor" with subtype="${subtype}" in accessory`);
        const alarmSOS = update!.value as boolean;
        service.getCharacteristic(Characteristic.ContactSensorState)!.updateValue(alarmSOS);
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
