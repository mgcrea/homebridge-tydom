import { getTydomDataPropValue } from "../api/types.js";
import type { CharacteristicProps, Service } from "homebridge";
import {
  debug,
  debugAddSubService,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
} from "../platform/trace.js";
import type {
  TydomDeviceThermostatAuthorization,
  TydomDeviceThermostatData,
  TydomDeviceThermostatHvacMode,
  TydomDeviceThermostatThermicLevel,
} from "../typings/tydom.js";
import { styleString } from "../util/style.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/**
 * Which thermic levels get their own switch.
 *
 * The hardware exposes up to six (ECO, MODERATO, MEDIO, COMFORT, STOP,
 * ANTI_FROST); publishing all of them buries the thermostat under switches.
 */
const EXPOSED_THERMIC_LEVELS = new Set(["ANTI_FROST", "ECO", "COMFORT"]);

/** An electric heating controller (Delta Dore RF4890, RF6600FP). */
export class ThermostatAccessory extends BaseAccessory {
  readonly #service: Service;
  /** Thermic-level switches, by the Tydom value each one selects. */
  readonly #levelSwitches = new Map<string, Service>();

  constructor(deps: AccessoryDeps) {
    super(deps);
    const {
      TargetHeatingCoolingState,
      CurrentHeatingCoolingState,
      TargetTemperature,
      CurrentTemperature,
    } = this.platform.Characteristic;
    this.#service = this.service(this.platform.Service.Thermostat);

    this.#service
      .getCharacteristic(CurrentHeatingCoolingState)
      // These devices only heat, so COOL and AUTO are not offered.
      .setProps({ validValues: [0, 1] } as Partial<CharacteristicProps>)
      .onGet(async () => {
        debugGet(CurrentHeatingCoolingState, this.#service);
        const data = await this.#read();
        const authorization = getTydomDataPropValue<TydomDeviceThermostatAuthorization>(
          data,
          "authorization",
        );
        const setpoint = getTydomDataPropValue<number>(data, "setpoint");
        const temperature = getTydomDataPropValue<number>(data, "temperature");
        const nextValue =
          authorization === "HEATING" && setpoint > temperature
            ? CurrentHeatingCoolingState.HEAT
            : CurrentHeatingCoolingState.OFF;
        debugGetResult(CurrentHeatingCoolingState, this.#service, nextValue);
        return nextValue;
      });

    this.#service
      .getCharacteristic(TargetHeatingCoolingState)
      .setProps({ validValues: [0, 1] } as Partial<CharacteristicProps>)
      .onGet(async () => {
        debugGet(TargetHeatingCoolingState, this.#service);
        const data = await this.#read();
        const hvacMode = getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, "hvacMode");
        const authorization = getTydomDataPropValue<TydomDeviceThermostatAuthorization>(
          data,
          "authorization",
        );
        const nextValue =
          authorization === "HEATING" && hvacMode === "NORMAL"
            ? TargetHeatingCoolingState.HEAT
            : TargetHeatingCoolingState.OFF;
        debugGetResult(TargetHeatingCoolingState, this.#service, nextValue);
        return nextValue;
      })
      .onSet(async (value) => {
        debugSet(TargetHeatingCoolingState, this.#service, value);
        const shouldHeat = [
          TargetHeatingCoolingState.HEAT,
          TargetHeatingCoolingState.AUTO,
        ].includes(value as number);
        const tydomValue = shouldHeat ? "NORMAL" : "STOP";
        await this.#writeHvacMode(tydomValue);
        debugSetResult(TargetHeatingCoolingState, this.#service, value, tydomValue);
        // The gateway does not echo a current-state change, so reflect it now.
        this.#service
          .getCharacteristic(CurrentHeatingCoolingState)
          .updateValue(
            shouldHeat ? CurrentHeatingCoolingState.HEAT : CurrentHeatingCoolingState.OFF,
          );
      });

    this.#service.getCharacteristic(CurrentTemperature).onGet(async () => {
      debugGet(CurrentTemperature, this.#service);
      const temperature = getTydomDataPropValue<number>(await this.#read(), "temperature");
      debugGetResult(CurrentTemperature, this.#service, temperature);
      return temperature;
    });

    this.#service
      .getCharacteristic(TargetTemperature)
      .onGet(async () => {
        debugGet(TargetTemperature, this.#service);
        const setpoint = getTydomDataPropValue<number>(await this.#read(), "setpoint");
        debugGetResult(TargetTemperature, this.#service, setpoint);
        return setpoint;
      })
      .onSet(async (value) => {
        debugSet(TargetTemperature, this.#service, value);
        await this.api.putDeviceData(this.deviceId, this.endpointId, [{ name: "setpoint", value }]);
        debugSetResult(TargetTemperature, this.#service, value);
      });

    this.#setupThermicLevels();
  }

  protected override apply(updates: Record<string, unknown>[]): void {
    const {
      TargetHeatingCoolingState,
      CurrentHeatingCoolingState,
      TargetTemperature,
      CurrentTemperature,
    } = this.platform.Characteristic;

    for (const { name, value } of updates) {
      switch (name) {
        case "authorization": {
          if (value !== "STOP") {
            break;
          }
          debugSetUpdate(CurrentHeatingCoolingState, this.#service, CurrentHeatingCoolingState.OFF);
          this.#service.updateCharacteristic(
            CurrentHeatingCoolingState,
            CurrentHeatingCoolingState.OFF,
          );
          // Probably came from the Tydom app; agree on the target state too.
          debugSetUpdate(TargetHeatingCoolingState, this.#service, TargetHeatingCoolingState.OFF);
          this.#service.updateCharacteristic(
            TargetHeatingCoolingState,
            TargetHeatingCoolingState.OFF,
          );
          break;
        }
        case "hvacMode": {
          const hvacMode = value as TydomDeviceThermostatHvacMode;
          if (hvacMode === "NORMAL") {
            break;
          }
          this.#service.updateCharacteristic(
            TargetHeatingCoolingState,
            TargetHeatingCoolingState.OFF,
          );
          if (hvacMode === "ANTI_FROST") {
            this.#selectLevel("ANTI_FROST");
          }
          break;
        }
        case "thermicLevel": {
          if (value === null || value === undefined) {
            debug(`Encountered a ${styleString("thermicLevel")} update with a null value!`);
            break;
          }
          this.#selectLevel(value as TydomDeviceThermostatThermicLevel);
          break;
        }
        case "setpoint": {
          if (value === null || value === undefined) {
            debug(`Encountered a ${styleString("setpoint")} update with a null value!`);
            break;
          }
          debugSetUpdate(TargetTemperature, this.#service, value);
          this.#service.updateCharacteristic(TargetTemperature, value as number);
          break;
        }
        case "temperature": {
          debugSetUpdate(CurrentTemperature, this.#service, value);
          this.#service.updateCharacteristic(CurrentTemperature, value as number);
          break;
        }
        default:
          break;
      }
    }
  }

  async #read(): Promise<TydomDeviceThermostatData> {
    return this.read<TydomDeviceThermostatData>();
  }

  async #writeHvacMode(value: string): Promise<void> {
    await this.api.putDeviceData(this.deviceId, this.endpointId, [{ name: "hvacMode", value }]);
  }

  /**
   * Turn on the switch for `level` and turn every other one off.
   *
   * The released update path only ever turned one on, so a level chosen from
   * the Tydom app left the previous switch showing on as well — two mutually
   * exclusive modes both lit in the Home app.
   */
  #selectLevel(level: string): void {
    const { On } = this.platform.Characteristic;
    for (const [value, service] of this.#levelSwitches) {
      const nextValue = value === level;
      debugSetUpdate(On, service, nextValue);
      service.updateCharacteristic(On, nextValue);
    }
  }

  #setupThermicLevels(): void {
    const { metadata } = this.accessory.context;
    const thermicLevel = metadata.find(({ name }) => name === "thermicLevel");
    const values = thermicLevel?.enum_values;
    if (!values || values.length === 0) {
      this.platform.log.error(
        `Failed to properly create the thermostat accessory for device ${this.deviceId}: no "thermicLevel" entry in its metadata`,
      );
      return;
    }

    // A single value means the device only offers absence (anti-frost) mode.
    if (values.length === 1) {
      this.#addLevelSwitch("ANTI_FROST", "hvacMode_absence", this.t("HVAC_INFO_ABSENCE"));
      return;
    }

    for (const value of values.filter((v) => EXPOSED_THERMIC_LEVELS.has(v))) {
      this.#addLevelSwitch(
        value,
        `thermicLevel_${value.toLowerCase()}`,
        this.t(`HVAC_LEVEL_${value}`),
      );
    }
  }

  #addLevelSwitch(tydomValue: string, subtype: string, name: string): void {
    const { On } = this.platform.Characteristic;
    const service = this.subService(this.platform.Service.Switch, name, subtype);
    debugAddSubService(service, this.accessory);
    this.#service.addLinkedService(service);
    this.#levelSwitches.set(tydomValue, service);

    service
      .getCharacteristic(On)
      .onGet(async () => {
        debugGet(On, service);
        const data = await this.#read();
        const nextValue =
          subtype === "hvacMode_absence"
            ? getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, "hvacMode") ===
              "ANTI_FROST"
            : getTydomDataPropValue<TydomDeviceThermostatThermicLevel>(data, "thermicLevel") ===
              tydomValue;
        debugGetResult(On, service, nextValue);
        return nextValue;
      })
      .onSet(async (value) => {
        debugSet(On, service, value);
        const tydomMode = value ? tydomValue : "NORMAL";
        await this.#writeHvacMode(tydomMode);
        debugSetResult(On, service, value, tydomMode);
        if (value) {
          this.#selectLevel(tydomValue);
        }
      });
  }
}

export const createThermostatAccessory = (deps: AccessoryDeps): ThermostatAccessory =>
  new ThermostatAccessory(deps);
