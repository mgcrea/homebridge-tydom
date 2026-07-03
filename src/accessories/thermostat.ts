import type { Service as HomebridgeService, PlatformAccessory } from "homebridge";
import { get } from "lodash";
import { Characteristic, CharacteristicProps, Service } from "src/config/hap";
import locale from "src/config/locale";
import TydomController from "src/controller";
import {
  addAccessoryService,
  addAccessoryServiceWithSubtype,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "src/helpers/accessory";
import { getTydomDataPropValue, getTydomDeviceData } from "src/helpers/tydom";
import type {
  TydomAccessoryContext,
  TydomDeviceThermostatAuthorization,
  TydomDeviceThermostatData,
  TydomDeviceThermostatHvacMode,
  TydomDeviceThermostatThermicLevel,
  TydomEndpointData,
  TydomMetaElement,
} from "src/typings/tydom";
import { chalkString } from "src/utils/color";
import {
  debug,
  debugAddSubService,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
} from "src/utils/debug";

type ThermicLevelSettings = {
  thermicLevelOnly?: boolean;
};

const THERMIC_LEVELS_WHITELIST = ["ANTI_FROST", "ECO", "COMFORT"];
const THERMIC_LEVEL_SWITCH_SUBTYPE_PREFIX = "thermicLevel_";
const ABSENCE_MODE_SWITCH_SUBTYPE = "hvacMode_absence";

const THERMIC_LEVEL_ONLY_CURRENT_TEMPERATURE = 20;
const THERMIC_LEVEL_TARGET_TEMPERATURES: Record<TydomDeviceThermostatThermicLevel, number> = {
  STOP: 7,
  ANTI_FROST: 7,
  ECO: 17,
  MODERATO: 18,
  MEDIO: 19,
  COMFORT: 20,
  AUTO: 20,
};

const getTydomDataPropValueOrNull = <
  V extends string | number | boolean,
  T extends TydomEndpointData = TydomEndpointData,
>(
  data: T,
  name: string,
): V | null => {
  const item = data.find((prop) => prop.name === name);
  return item ? (item.value as V) : null;
};

const hasThermostatTemperatureSupport = (metadata: TydomMetaElement[]): boolean =>
  ["setpoint", "temperature", "hvacMode"].every((name) => metadata.some((prop) => prop.name === name));

const shouldUseThermicLevelOnlyMode = (
  metadata: TydomMetaElement[],
  settings: ThermicLevelSettings,
): boolean =>
  Boolean(settings.thermicLevelOnly) ||
  (metadata.some((prop) => prop.name === "thermicLevel") && !hasThermostatTemperatureSupport(metadata));

const removeThermicLevelSwitchServices = (accessory: PlatformAccessory<TydomAccessoryContext>): void => {
  accessory.services
    .filter(
      (service) =>
        service.UUID === Service.Switch.UUID &&
        (service.subtype?.startsWith(THERMIC_LEVEL_SWITCH_SUBTYPE_PREFIX) ||
          service.subtype === ABSENCE_MODE_SWITCH_SUBTYPE),
    )
    .forEach((service) => {
      accessory.removeService(service);
    });
};

const getThermicLevelTargetTemperature = (thermicLevel: TydomDeviceThermostatThermicLevel): number =>
  THERMIC_LEVEL_TARGET_TEMPERATURES[thermicLevel] ?? THERMIC_LEVEL_TARGET_TEMPERATURES.COMFORT;

const getCurrentHeatingCoolingStateFromThermicLevel = (
  thermicLevel: TydomDeviceThermostatThermicLevel,
  authorization: TydomDeviceThermostatAuthorization | null,
): number => {
  const { CurrentHeatingCoolingState } = Characteristic;
  return authorization === "STOP" || thermicLevel === "STOP"
    ? CurrentHeatingCoolingState.OFF
    : thermicLevel === "ANTI_FROST"
      ? CurrentHeatingCoolingState.COOL
      : CurrentHeatingCoolingState.HEAT;
};

const getTargetHeatingCoolingStateFromThermicLevel = (
  thermicLevel: TydomDeviceThermostatThermicLevel,
  authorization: TydomDeviceThermostatAuthorization | null,
): number => {
  const { TargetHeatingCoolingState } = Characteristic;
  if (authorization === "STOP" || thermicLevel === "STOP") {
    return TargetHeatingCoolingState.OFF;
  }
  if (thermicLevel === "COMFORT") {
    return TargetHeatingCoolingState.HEAT;
  }
  if (thermicLevel === "ECO") {
    return TargetHeatingCoolingState.HEAT;
  }
  if (thermicLevel === "AUTO") {
    return TargetHeatingCoolingState.AUTO;
  }
  if (thermicLevel === "ANTI_FROST") {
    return TargetHeatingCoolingState.COOL;
  }
  return TargetHeatingCoolingState.AUTO;
};

const getThermicLevelFromTargetHeatingCoolingState = (value: number): TydomDeviceThermostatThermicLevel => {
  const { TargetHeatingCoolingState } = Characteristic;
  switch (value) {
    case TargetHeatingCoolingState.OFF:
      return "STOP";
    case TargetHeatingCoolingState.COOL:
      return "ANTI_FROST";
    case TargetHeatingCoolingState.AUTO:
      return "AUTO";
    case TargetHeatingCoolingState.HEAT:
    default:
      return "COMFORT";
  }
};

const getThermicLevelFromTargetTemperature = (value: number): TydomDeviceThermostatThermicLevel => {
  if (value <= 10) {
    return "ANTI_FROST";
  }
  if (value <= 18) {
    return "ECO";
  }
  return "COMFORT";
};

const getThermicLevelOnlyData = async (
  client: TydomController["client"],
  deviceId: number,
  endpointId: number,
): Promise<{
  authorization: TydomDeviceThermostatAuthorization | null;
  thermicLevel: TydomDeviceThermostatThermicLevel;
}> => {
  const data = await getTydomDeviceData<TydomEndpointData>(client, { deviceId, endpointId });
  const thermicLevel =
    getTydomDataPropValueOrNull<TydomDeviceThermostatThermicLevel>(data, "thermicLevel") ?? "COMFORT";
  const authorization = getTydomDataPropValueOrNull<TydomDeviceThermostatAuthorization>(data, "authorization");
  return { authorization, thermicLevel };
};

const setupThermicLevelOnlyThermostat = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
  service: HomebridgeService,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { TargetHeatingCoolingState, CurrentHeatingCoolingState, TargetTemperature, CurrentTemperature } =
    Characteristic;
  const { deviceId, endpointId } = context;

  removeThermicLevelSwitchServices(accessory);

  service
    .getCharacteristic(CurrentHeatingCoolingState)
    .setProps({
      validValues: [
        CurrentHeatingCoolingState.OFF,
        CurrentHeatingCoolingState.HEAT,
        CurrentHeatingCoolingState.COOL,
      ],
    })
    .onGet(async () => {
      debugGet(CurrentHeatingCoolingState, service);
      const { authorization, thermicLevel } = await getThermicLevelOnlyData(client, deviceId, endpointId);
      const nextValue = getCurrentHeatingCoolingStateFromThermicLevel(thermicLevel, authorization);
      debugGetResult(CurrentHeatingCoolingState, service, nextValue);
      return nextValue;
    });

  service
    .getCharacteristic(TargetHeatingCoolingState)
    .setProps({
      validValues: [
        TargetHeatingCoolingState.OFF,
        TargetHeatingCoolingState.HEAT,
        TargetHeatingCoolingState.COOL,
        TargetHeatingCoolingState.AUTO,
      ],
    })
    .onGet(async () => {
      debugGet(TargetHeatingCoolingState, service);
      const { authorization, thermicLevel } = await getThermicLevelOnlyData(client, deviceId, endpointId);
      const nextValue = getTargetHeatingCoolingStateFromThermicLevel(thermicLevel, authorization);
      debugGetResult(TargetHeatingCoolingState, service, nextValue);
      return nextValue;
    })
    .onSet(async (value) => {
      debugSet(TargetHeatingCoolingState, service, value);
      const thermicLevel = getThermicLevelFromTargetHeatingCoolingState(value as number);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "thermicLevel",
          value: thermicLevel,
        },
      ]);
      debugSetResult(TargetHeatingCoolingState, service, value, thermicLevel);
      service.updateCharacteristic(
        CurrentHeatingCoolingState,
        getCurrentHeatingCoolingStateFromThermicLevel(
          thermicLevel,
          thermicLevel === "STOP" ? "STOP" : "HEATING",
        ),
      );
      service.updateCharacteristic(TargetTemperature, getThermicLevelTargetTemperature(thermicLevel));
      service.updateCharacteristic(CurrentTemperature, THERMIC_LEVEL_ONLY_CURRENT_TEMPERATURE);
    });

  service
    .getCharacteristic(CurrentTemperature)
    .setProps({ minValue: 0, maxValue: 40, minStep: 1 })
    .onGet(async () => {
      debugGet(CurrentTemperature, service);
      debugGetResult(CurrentTemperature, service, THERMIC_LEVEL_ONLY_CURRENT_TEMPERATURE);
      return THERMIC_LEVEL_ONLY_CURRENT_TEMPERATURE;
    });

  service
    .getCharacteristic(TargetTemperature)
    .setProps({ minValue: 7, maxValue: 20, minStep: 1 })
    .onGet(async () => {
      debugGet(TargetTemperature, service);
      const { thermicLevel } = await getThermicLevelOnlyData(client, deviceId, endpointId);
      const nextValue = getThermicLevelTargetTemperature(thermicLevel);
      debugGetResult(TargetTemperature, service, nextValue);
      return nextValue;
    })
    .onSet(async (value) => {
      debugSet(TargetTemperature, service, value);
      const thermicLevel = getThermicLevelFromTargetTemperature(value as number);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "thermicLevel",
          value: thermicLevel,
        },
      ]);
      debugSetResult(TargetTemperature, service, value, thermicLevel);
      const nextTargetHeatingCoolingState = getTargetHeatingCoolingStateFromThermicLevel(
        thermicLevel,
        "HEATING",
      );
      service.updateCharacteristic(TargetHeatingCoolingState, nextTargetHeatingCoolingState);
      service.updateCharacteristic(
        CurrentHeatingCoolingState,
        getCurrentHeatingCoolingStateFromThermicLevel(thermicLevel, "HEATING"),
      );
      service.updateCharacteristic(CurrentTemperature, THERMIC_LEVEL_ONLY_CURRENT_TEMPERATURE);
    });
};

export const setupThermostat = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { TargetHeatingCoolingState, CurrentHeatingCoolingState, TargetTemperature, CurrentTemperature, On } =
    Characteristic;

  const { deviceId, endpointId, metadata } = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  const thermicLevelData = metadata.find(({ name }) => name === "thermicLevel");
  const thermicLevelOnly = shouldUseThermicLevelOnlyMode(
    metadata,
    (context.settings ?? {}) as ThermicLevelSettings,
  );

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.Thermostat, accessory.displayName, true);

  if (thermicLevelOnly) {
    if (!thermicLevelData) {
      controller.log.error(
        `Failed to properly create the thermic-level thermostat accessory for device ${deviceId}, did not found object in array that matches {"name": "thermicLevel"} in ${JSON.stringify(
          metadata,
        )}`,
      );
      return;
    }
    setupThermicLevelOnlyThermostat(accessory, controller, service);
    return;
  }

  service
    .getCharacteristic(CurrentHeatingCoolingState)
    .setProps({ validValues: [0, 1] } as Partial<CharacteristicProps>) // [OFF, HEAT, COOL]
    .onGet(async () => {
      debugGet(CurrentHeatingCoolingState, service);
      const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, { deviceId, endpointId });
      const authorization = getTydomDataPropValue<TydomDeviceThermostatAuthorization>(data, "authorization");
      const setpoint = getTydomDataPropValue<number>(data, "setpoint");
      const temperature = getTydomDataPropValue<number>(data, "temperature");
      const nextValue =
        authorization === "HEATING" && setpoint > temperature
          ? CurrentHeatingCoolingState.HEAT
          : CurrentHeatingCoolingState.OFF;
      debugGetResult(CurrentHeatingCoolingState, service, nextValue);
      return nextValue;
    });

  service
    .getCharacteristic(TargetHeatingCoolingState)
    .setProps({ validValues: [0, 1] } as Partial<CharacteristicProps>) // [OFF, HEAT, COOL, AUTO]
    .onGet(async () => {
      debugGet(TargetHeatingCoolingState, service);
      const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, { deviceId, endpointId });
      const hvacMode = getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, "hvacMode");
      const authorization = getTydomDataPropValue<"STOP" | "HEATING">(data, "authorization");
      const nextValue =
        authorization === "HEATING" && ["NORMAL"].includes(hvacMode)
          ? TargetHeatingCoolingState.HEAT
          : TargetHeatingCoolingState.OFF;
      debugGetResult(TargetHeatingCoolingState, service, nextValue);
      return nextValue;
    })
    .onSet(async (value) => {
      debugSet(TargetHeatingCoolingState, service, value);
      const shouldHeat = [TargetHeatingCoolingState.HEAT, TargetHeatingCoolingState.AUTO].includes(
        value as number,
      );
      const tydomValue = shouldHeat ? "NORMAL" : "STOP";
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "hvacMode",
          value: tydomValue,
        },
      ]);
      debugSetResult(TargetHeatingCoolingState, service, value, tydomValue);
      // @NOTE directly update currentHeadingCoolingState
      service
        .getCharacteristic(CurrentHeatingCoolingState)
        .updateValue(shouldHeat ? CurrentHeatingCoolingState.HEAT : CurrentHeatingCoolingState.OFF);
    });

  service.getCharacteristic(CurrentTemperature).onGet(async () => {
    debugGet(CurrentTemperature, service);
    const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, { deviceId, endpointId });
    const temperature = getTydomDataPropValue<number>(data, "temperature");
    debugGetResult(CurrentTemperature, service, temperature);
    return temperature;
  });

  service
    .getCharacteristic(TargetTemperature)
    .onGet(async () => {
      debugGet(TargetTemperature, service);
      const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, { deviceId, endpointId });
      const setpoint = getTydomDataPropValue<number>(data, "setpoint");
      debugGetResult(TargetTemperature, service, setpoint);
      return setpoint;
    })
    .onSet(async (value) => {
      debugSet(TargetTemperature, service, value);
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "setpoint",
          value: value,
        },
      ]);
      debugSetResult(TargetTemperature, service, value);
    });

  if (!thermicLevelData) {
    controller.log.error(
      `Failed to properly create the thermostat accesory for device ${deviceId}, did not found object in array that matches {"name": "thermicLevel"} in ${JSON.stringify(
        metadata,
      )}`,
    );
    return;
  }
  const thermicLevelValues = thermicLevelData.enum_values!;

  // Only absence (aka. anti-frost) mode
  if (thermicLevelValues.length === 1) {
    const absenceModeId = `hvacMode_absence`;
    const absenceModeName = get(locale, "HVAC_INFO_ABSENCE", "N/A");
    const absenceModeService = addAccessoryServiceWithSubtype(
      accessory,
      Service.Switch,
      absenceModeName,
      absenceModeId,
      true,
    );
    debugAddSubService(absenceModeService, accessory);
    service.addLinkedService(absenceModeService);
    absenceModeService
      .getCharacteristic(On)
      .onGet(async () => {
        debugGet(On, absenceModeService);
        const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, { deviceId, endpointId });
        const hvacMode = getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, "hvacMode");
        // const antifrostOn = getTydomDataPropValue<boolean>(data, 'antifrostOn');
        // const nextValue = hvacMode === 'ANTI_FROST' && antifrostOn;
        const nextValue = hvacMode === "ANTI_FROST";
        debugGetResult(On, absenceModeService, nextValue);
        return nextValue;
      })
      .onSet(async (value) => {
        debugSet(On, absenceModeService, value);
        const tydomValue = value ? "ANTI_FROST" : "NORMAL";
        await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
          {
            name: "hvacMode",
            value: tydomValue,
          },
        ]);
        debugSetResult(On, absenceModeService, value, tydomValue);
      });
  }

  // Multiple thermic levels
  // "enum_values": ["ECO", "MODERATO", "MEDIO", "COMFORT", "STOP", "ANTI_FROST"]
  if (thermicLevelValues.length > 1) {
    const thermicLevelServices = thermicLevelValues
      .filter((value) => THERMIC_LEVELS_WHITELIST.includes(value))
      .map((thermicLevelValue) => {
        const thermicLevelId = `thermicLevel_${thermicLevelValue.toLowerCase()}`;
        const thermicLevelName = get(locale, `HVAC_LEVEL_${thermicLevelValue}`, "N/A") as string;
        const thermicLevelService = addAccessoryServiceWithSubtype(
          accessory,
          Service.Switch,
          thermicLevelName,
          thermicLevelId,
          true,
        );
        debugAddSubService(thermicLevelService, accessory);
        service.addLinkedService(thermicLevelService);
        thermicLevelService
          .getCharacteristic(On)
          .onGet(async () => {
            debugGet(On, thermicLevelService);
            const data = await getTydomDeviceData<TydomDeviceThermostatData>(client, {
              deviceId,
              endpointId,
            });
            const thermicLevel = getTydomDataPropValue<TydomDeviceThermostatThermicLevel>(
              data,
              "thermicLevel",
            );
            const nextValue = thermicLevel === thermicLevelValue;
            debugGetResult(On, thermicLevelService, nextValue);
            return nextValue;
          })
          .onSet(async (value) => {
            debugSet(On, thermicLevelService, value);
            const tydomValue = value ? thermicLevelValue : "NORMAL";
            await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
              {
                name: "hvacMode",
                value: tydomValue,
              },
            ]);
            debugSetResult(On, thermicLevelService, tydomValue);
            // @NOTE disable any other existing thermicLevel
            thermicLevelServices
              .filter(({ value }) => value !== thermicLevelValue)
              .forEach(({ service }) => {
                service.updateCharacteristic(On, false);
              });
          });
        return { value: thermicLevelValue, service: thermicLevelService };
      });
  }
};

export const updateThermostat = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
): void => {
  const { TargetHeatingCoolingState, CurrentHeatingCoolingState, TargetTemperature, CurrentTemperature, On } =
    Characteristic;
  const thermicLevelOnly = shouldUseThermicLevelOnlyMode(
    accessory.context.metadata,
    (accessory.context.settings ?? {}) as ThermicLevelSettings,
  );

  updates.forEach((update) => {
    const { name, value } = update;
    switch (name) {
      case "authorization": {
        const service = getAccessoryService(accessory, Service.Thermostat);
        const authorization = value as TydomDeviceThermostatAuthorization;
        if (authorization === "HEATING") {
          // @TODO Trigger a get as we miss info
          return;
        }
        if (authorization === "STOP") {
          debugSetUpdate(CurrentHeatingCoolingState, service, CurrentHeatingCoolingState.OFF);
          service.updateCharacteristic(CurrentHeatingCoolingState, CurrentHeatingCoolingState.OFF);
          // External update probably comes from the Tydom app, let's agree on the target state
          debugSetUpdate(TargetHeatingCoolingState, service, TargetHeatingCoolingState.OFF);
          service.updateCharacteristic(TargetHeatingCoolingState, TargetHeatingCoolingState.OFF);
          return;
        }
        return;
      }
      case "hvacMode": {
        const service = getAccessoryService(accessory, Service.Thermostat);
        const hvacMode = value as TydomDeviceThermostatHvacMode;
        if (hvacMode === "NORMAL") {
          // @TODO Trigger a get as we miss info
          return;
        }
        service.updateCharacteristic(TargetHeatingCoolingState, CurrentHeatingCoolingState.OFF);
        if (hvacMode === "ANTI_FROST") {
          const subtype = "hvacMode_absence";
          const service = accessory.getServiceById(Service.Switch, subtype);
          if (service) {
            debugSetUpdate(On, service, true);
            service.updateCharacteristic(On, true);
            return;
          }
        }
        return;
      }
      case "thermicLevel": {
        const thermicLevel = value as TydomDeviceThermostatThermicLevel;
        if (thermicLevel === null) {
          debug(`Encountered a ${chalkString("thermicLevel")} update with a null value!`);
          return;
        }
        if (thermicLevelOnly) {
          const service = getAccessoryService(accessory, Service.Thermostat);
          const authorization = updates.find((update) => update.name === "authorization")?.value as
            | TydomDeviceThermostatAuthorization
            | undefined;
          const nextAuthorization = authorization ?? (thermicLevel === "STOP" ? "STOP" : "HEATING");
          const nextCurrentHeatingCoolingState = getCurrentHeatingCoolingStateFromThermicLevel(
            thermicLevel,
            nextAuthorization,
          );
          const nextTargetHeatingCoolingState = getTargetHeatingCoolingStateFromThermicLevel(
            thermicLevel,
            nextAuthorization,
          );
          const nextTargetTemperature = getThermicLevelTargetTemperature(thermicLevel);
          debugSetUpdate(CurrentHeatingCoolingState, service, nextCurrentHeatingCoolingState);
          service.updateCharacteristic(CurrentHeatingCoolingState, nextCurrentHeatingCoolingState);
          debugSetUpdate(TargetHeatingCoolingState, service, nextTargetHeatingCoolingState);
          service.updateCharacteristic(TargetHeatingCoolingState, nextTargetHeatingCoolingState);
          debugSetUpdate(CurrentTemperature, service, THERMIC_LEVEL_ONLY_CURRENT_TEMPERATURE);
          service.updateCharacteristic(CurrentTemperature, THERMIC_LEVEL_ONLY_CURRENT_TEMPERATURE);
          debugSetUpdate(TargetTemperature, service, nextTargetTemperature);
          service.updateCharacteristic(TargetTemperature, nextTargetTemperature);
          return;
        }
        const service = accessory.getServiceById(Service.Switch, `thermicLevel_${thermicLevel.toLowerCase()}`);
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
      case "setpoint": {
        const setpoint = value as number;
        if (setpoint === null) {
          debug(`Encountered a ${chalkString("setpoint")} update with a null value!`);
          return;
        }
        const service = getAccessoryService(accessory, Service.Thermostat);
        debugSetUpdate(TargetTemperature, service, setpoint);
        service.updateCharacteristic(TargetTemperature, setpoint);
        return;
      }
      case "temperature": {
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
