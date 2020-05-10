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
import TydomController, {ControllerDevicePayload, ControllerUpdatePayload} from 'src/controller';
import {PlatformAccessory, TydomAccessoryUpdateContext} from 'src/typings/homebridge';
import {
  SecuritySystemAlarmEvent,
  SecuritySystemLabelCommandResult,
  TydomDeviceSecuritySystemAlarmMode,
  TydomDeviceSecuritySystemAlarmState,
  TydomDeviceSecuritySystemData,
  TydomDeviceSecuritySystemZoneState
} from 'src/typings/tydom';
import {
  addAccessoryService,
  addAccessoryServiceWithSubtype,
  getAccessoryService,
  getAccessoryServiceWithSubtype,
  SECURITY_SYSTEM_SENSORS,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
  TydomAccessoryUpdateType
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import {chalkJson, chalkKeyword} from 'src/utils/chalk';
import debug, {
  debugAddSubService,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate
} from 'src/utils/debug';
import {decode} from 'src/utils/hash';
import {getTydomDataPropValue, getTydomDeviceData} from 'src/utils/tydom';

type ZoneAliases = {
  stay?: number[];
  night?: number[];
};

const {SecuritySystemTargetState, SecuritySystemCurrentState, StatusTampered, ContactSensorState, On} = Characteristic;

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

export const setupSecuritySystem = async (accessory: PlatformAccessory, controller: TydomController): Promise<void> => {
  const {context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId, settings} = context;
  // const zones = (settings.zones || []) as string[];
  const aliases = (settings.aliases || {}) as ZoneAliases;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Create separate dedicated sensor extra accessory;
  if (settings.sensors !== false) {
    const {accessoryId} = context;
    const extraDevice: ControllerDevicePayload = {
      ...context,
      name: `${get(locale, 'ALARME_ISSUES_OUVERTES', 'N/A') as string}`,
      category: SECURITY_SYSTEM_SENSORS,
      accessoryId: `${accessoryId}:sensors`
    };
    controller.emit('device', extraDevice);
  }

  const initialData = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
  const labelResults = await client.command<SecuritySystemLabelCommandResult>(
    `/devices/${deviceId}/endpoints/${endpointId}/cdata?name=label`
  );
  const {zones} = labelResults[0];
  // Pin code check
  const pin = HOMEBRIDGE_TYDOM_PIN ? decode(HOMEBRIDGE_TYDOM_PIN) : settings.pin;
  if (!pin) {
    controller.log.warn(
      `Missing pin for device securitySystem, add either {"settings": {"${deviceId}": {"pin": "123456"}}} or HOMEBRIDGE_TYDOM_PIN env var (base64 encoded)`
    );
  }

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.SecuritySystem, `${accessory.displayName}`, true);

  service
    .getCharacteristic(SecuritySystemCurrentState)
    .setValue(SecuritySystemCurrentState.DISARMED) // Default to disarmed to prevent notifications
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(SecuritySystemCurrentState, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
        const alarmState = getTydomDataPropValue<TydomDeviceSecuritySystemAlarmState>(data, 'alarmState');
        const alarmMode = getTydomDataPropValue<TydomDeviceSecuritySystemAlarmMode>(data, 'alarmMode');
        const nextValue = getCurrrentStateForValue(alarmState, alarmMode);
        debugGetResult(SecuritySystemCurrentState, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .getValue();

  service
    .getCharacteristic(StatusTampered)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(StatusTampered, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
        const systAutoProtect = getTydomDataPropValue<boolean>(data, 'systAutoProtect');
        debugGetResult(StatusTampered, service, systAutoProtect);
        callback(null, systAutoProtect);
      } catch (err) {
        callback(err);
      }
    })
    .getValue();

  service
    .getCharacteristic(SecuritySystemTargetState)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(SecuritySystemTargetState, service);
      try {
        const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
        const alarmMode = getTydomDataPropValue<TydomDeviceSecuritySystemAlarmMode>(data, 'alarmMode');
        const nextValue = getTargetStateForValue(alarmMode);
        debugGetResult(SecuritySystemTargetState, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err);
      }
    })
    .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      debugSet(SecuritySystemTargetState, service, value);
      if (!pin) {
        callback();
        return;
      }
      // Clear preAlarm trigger
      if ([SecuritySystemTargetState.DISARM].includes(value as number)) {
        preAlarmService.updateCharacteristic(ContactSensorState, false);
      }
      // Global ON/OFF
      if ([SecuritySystemTargetState.AWAY_ARM, SecuritySystemTargetState.DISARM].includes(value as number)) {
        const tydomValue = value === SecuritySystemTargetState.DISARM ? 'OFF' : 'ON';
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/cdata?name=alarmCmd`, {
          value: tydomValue,
          pwd: pin
        });
        debugSetResult(SecuritySystemTargetState, service, value, tydomValue);
        callback();
        return;
      }
      // Zones ON/OFF
      if ([SecuritySystemTargetState.STAY_ARM, SecuritySystemTargetState.NIGHT_ARM].includes(value as number)) {
        const tydomValue = value === SecuritySystemTargetState.DISARM ? 'OFF' : 'ON';
        const targetZones = value === SecuritySystemTargetState.STAY_ARM ? aliases.stay : aliases.night;
        if (Array.isArray(targetZones) && targetZones.length > 0) {
          await client.put(`/devices/${deviceId}/endpoints/${endpointId}/cdata?name=zoneCmd`, {
            value: tydomValue,
            pwd: pin,
            zones: targetZones
          });
        }
        debugSetResult(SecuritySystemTargetState, service, value, tydomValue);
        callback();
        return;
      }
    });

  // Setup systOpenIssue contactSensor
  const systOpenIssueId = `systOpenIssue`;
  const systOpenIssueName = get(locale, 'ALARME_ISSUES_OUVERTES', 'N/A') as string;
  const systOpenIssueService = addAccessoryServiceWithSubtype(
    accessory,
    Service.ContactSensor,
    systOpenIssueName,
    systOpenIssueId,
    true
  );
  debugAddSubService(systOpenIssueService, accessory);
  service.addLinkedService(systOpenIssueService);
  systOpenIssueService
    .getCharacteristic(ContactSensorState)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(ContactSensorState, systOpenIssueService);
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
        const systOpenIssue = getTydomDataPropValue<boolean>(data, 'systOpenIssue');
        debugGetResult(ContactSensorState, systOpenIssueService, systOpenIssue);
        callback(null, systOpenIssue);
      } catch (err) {
        callback(err);
      }
    });
  systOpenIssueService.getCharacteristic(Characteristic.StatusActive).setValue(true);
  systOpenIssueService.getCharacteristic(Characteristic.StatusFault).setValue(false);

  // Setup alarmSOS contactSensor
  const alarmSOSId = `alarmSOS`;
  const alarmSOSName = get(locale, 'DISCRETE_ALARM_V3', 'N/A') as string;
  const alarmSOSService = addAccessoryServiceWithSubtype(
    accessory,
    Service.ContactSensor,
    alarmSOSName,
    alarmSOSId,
    true
  );
  debugAddSubService(alarmSOSService, accessory);
  service.addLinkedService(alarmSOSService);
  alarmSOSService
    .getCharacteristic(ContactSensorState)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(ContactSensorState, alarmSOSService);
      try {
        const data = (await getTydomDeviceData(client, {deviceId, endpointId})) as TydomDeviceSecuritySystemData;
        const alarmSOS = getTydomDataPropValue<boolean>(data, 'alarmSOS');
        debugGetResult(ContactSensorState, alarmSOSService, alarmSOS);
        callback(null, alarmSOS);
      } catch (err) {
        callback(err);
      }
    });
  alarmSOSService.getCharacteristic(Characteristic.StatusActive).setValue(true);
  alarmSOSService.getCharacteristic(Characteristic.StatusFault).setValue(false);

  // Setup preAlarm contactSensor
  const preAlarmId = `preAlarm`;
  const preAlarmName = get(locale, 'PREALARM', 'N/A') as string;
  const preAlarmService = addAccessoryServiceWithSubtype(
    accessory,
    Service.ContactSensor,
    preAlarmName,
    preAlarmId,
    true
  );
  debugAddSubService(preAlarmService, accessory);
  service.addLinkedService(preAlarmService);
  preAlarmService.getCharacteristic(ContactSensorState).setValue(false);
  preAlarmService.getCharacteristic(Characteristic.StatusActive).setValue(true);
  preAlarmService.getCharacteristic(Characteristic.StatusFault).setValue(false);

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
    debugAddSubService(zoneService, accessory);
    service.addLinkedService(zoneService);
    zoneService
      .getCharacteristic(On)
      .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
        debugGet(On, zoneService);
        try {
          const data = await getTydomDeviceData<TydomDeviceSecuritySystemData>(client, {deviceId, endpointId});
          const zoneState = getTydomDataPropValue<TydomDeviceSecuritySystemZoneState>(data, `zone${zoneIndex}State`);
          const nextValue = zoneState === 'ON';
          debugGetResult(On, zoneService, nextValue);
          callback(null, nextValue);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        debugSet(On, zoneService, value);
        if (!pin) {
          callback();
          return;
        }
        const tydomValue = value ? 'ON' : 'OFF';
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/cdata?name=zoneCmd`, {
          value: tydomValue,
          pwd: pin,
          zones: [zoneIndex]
        });
        debugSetResult(On, zoneService, value, tydomValue);
        callback();
      });
  }
};

export const updateSecuritySystem = (
  accessory: PlatformAccessory,
  controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomAccessoryUpdateType
) => {
  // Relay to separate dedicated sensor extra accessory;
  const {deviceId, endpointId, accessoryId, settings} = accessory.context;
  if (settings.sensors !== false) {
    const extraUpdateContext: TydomAccessoryUpdateContext = {
      category: SECURITY_SYSTEM_SENSORS,
      deviceId,
      endpointId,
      accessoryId: `${accessoryId}:sensors`
    };
    controller.emit('update', {
      type,
      updates,
      context: extraUpdateContext
    } as ControllerUpdatePayload);
  }

  // Process command updates
  if (type === 'cdata') {
    updates.forEach((update) => {
      const {name, values} = update;
      switch (name) {
        case 'eventAlarm': {
          const {event} = values as {event: SecuritySystemAlarmEvent};
          debug(`New ${chalkKeyword('SecuritySystem')} alarm event=${chalkJson(event)}`);
          switch (event.name) {
            case 'preAlarm': {
              const service = getAccessoryServiceWithSubtype(accessory, Service.ContactSensor, 'preAlarm');
              debugSetUpdate(ContactSensorState, service, true);
              service.updateCharacteristic(ContactSensorState, true);
              return;
            }
            default:
              return;
          }
        }
        default:
          return;
      }
    });
    return;
  }

  // Process alarmState/alarmMode together
  if (updates.some(({name}) => name === 'alarmState') && updates.some(({name}) => name === 'alarmMode')) {
    const alarmState = updates.find(({name}) => name === 'alarmState')?.value as TydomDeviceSecuritySystemAlarmState;
    const alarmMode = updates.find(({name}) => name === 'alarmMode')?.value as TydomDeviceSecuritySystemAlarmMode;
    const service = getAccessoryService(accessory, Service.SecuritySystem);
    const currentState = getCurrrentStateForValue(alarmState, alarmMode);
    debugSetUpdate(SecuritySystemCurrentState, service, currentState);
    service.updateCharacteristic(SecuritySystemCurrentState, currentState);
    if (currentState !== SecuritySystemCurrentState.ALARM_TRIGGERED) {
      // External update probably comes from the Tydom app, let's agree on the target state
      const nextValue = getTargetStateForValue(alarmMode);
      debugSetUpdate(SecuritySystemCurrentState, service, nextValue);
      service.updateCharacteristic(SecuritySystemTargetState, nextValue);
    }
  }

  updates.forEach((update) => {
    const {name, value} = update;
    switch (name) {
      case 'alarmState':
      case 'alarmMode': {
        // Handled above
        return;
      }
      case 'alarmSOS': {
        const service = getAccessoryServiceWithSubtype(accessory, Service.ContactSensor, 'alarmSOS');
        const alarmSOS = value as boolean;
        debugSetUpdate(ContactSensorState, service, alarmSOS);
        service.updateCharacteristic(ContactSensorState, alarmSOS);
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
        const zoneState = value as TydomDeviceSecuritySystemZoneState;
        if (zoneState === 'UNUSED') {
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const zoneIndex = parseInt(name.match(/zone(\d+)State/)![1], 10) - 1; // @NOTE Adjust for productId starting at 0
        const service = getAccessoryServiceWithSubtype(accessory, Service.Switch, `zone_${zoneIndex}`);
        const nextValue = zoneState === 'ON';
        debugSetUpdate(ContactSensorState, service, nextValue);
        service.updateCharacteristic(On, nextValue);
        return;
      }
      case 'systOpenIssue': {
        const service = getAccessoryServiceWithSubtype(accessory, Service.ContactSensor, 'systOpenIssue');
        const systOpenIssue = value as boolean;
        debugSetUpdate(ContactSensorState, service, systOpenIssue);
        service.updateCharacteristic(ContactSensorState, systOpenIssue);
        return;
      }
      default:
        return;
    }
  });
};
