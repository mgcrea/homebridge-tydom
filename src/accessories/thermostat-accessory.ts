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
  TydomThermostatModeProp,
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
  /**
   * Whether this device can cool as well as heat.
   *
   * Read from the endpoint's own metadata rather than configured: reversible
   * hardware — a heat pump that runs in reverse — advertises `COOLING` among
   * the values its `authorization` property accepts, and a radiator does not.
   * Offering HomeKit a cool mode on a radiator would put a button in the Home
   * app that silently does nothing.
   */
  readonly #canCool: boolean;
  /**
   * Which property carries the operating mode on this device.
   *
   * Delta Dore replaced `hvacMode` with `localMode` on newer thermostats — the
   * Tybox 5100 and relatives carry no `hvacMode` at all. Reading a property
   * that is not there throws, so on that hardware every
   * `TargetHeatingCoolingState` query failed: the accessory was discovered and
   * registered, then errored on every read. The values are the same apart from
   * an added `ABSENCE`, so resolving the name is the whole fix.
   *
   * `hvacMode` wins when both are present, so nothing changes for hardware that
   * already worked.
   */
  readonly #modeProp: TydomThermostatModeProp;

  constructor(deps: AccessoryDeps) {
    super(deps);
    const metadata = deps.accessory.context.metadata;
    const hasProp = (name: string): boolean => metadata.some((entry) => entry.name === name);
    this.#modeProp = hasProp("hvacMode")
      ? "hvacMode"
      : hasProp("localMode")
        ? "localMode"
        : "hvacMode";
    if (!hasProp("hvacMode") && !hasProp("localMode")) {
      deps.platform.log.warn(
        `Thermostat ${deps.accessory.displayName} advertises neither "hvacMode" nor "localMode"; its mode controls will not work.`,
      );
    }
    this.#canCool = Boolean(
      deps.accessory.context.metadata
        .find(({ name }) => name === "authorization")
        ?.enum_values?.includes("COOLING"),
    );
    const {
      TargetHeatingCoolingState,
      CurrentHeatingCoolingState,
      TargetTemperature,
      CurrentTemperature,
    } = this.platform.Characteristic;
    this.#service = this.service(this.platform.Service.Thermostat);

    this.#service
      .getCharacteristic(CurrentHeatingCoolingState)
      // AUTO is never offered: nothing in the protocol expresses "decide for
      // yourself". COOL only on hardware that advertises it.
      .setProps({
        validValues: this.#canCool ? [0, 1, 2] : [0, 1],
      } as Partial<CharacteristicProps>)
      .onGet(async () => {
        debugGet(CurrentHeatingCoolingState, this.#service);
        const data = await this.#read();
        const authorization = getTydomDataPropValue<TydomDeviceThermostatAuthorization>(
          data,
          "authorization",
        );
        const setpoint = getTydomDataPropValue<number>(data, "setpoint");
        const temperature = getTydomDataPropValue<number>(data, "temperature");
        // Symmetrical with the heating case: this characteristic reports what
        // the device is doing now, not what it is allowed to do, so an
        // authorised unit sitting at its setpoint reads OFF either way.
        let nextValue: number = CurrentHeatingCoolingState.OFF;
        if (authorization === "HEATING" && setpoint > temperature) {
          nextValue = CurrentHeatingCoolingState.HEAT;
        } else if (authorization === "COOLING" && temperature > setpoint) {
          nextValue = CurrentHeatingCoolingState.COOL;
        }
        debugGetResult(CurrentHeatingCoolingState, this.#service, nextValue);
        return nextValue;
      });

    this.#service
      .getCharacteristic(TargetHeatingCoolingState)
      .setProps({
        validValues: this.#canCool ? [0, 1, 2] : [0, 1],
      } as Partial<CharacteristicProps>)
      .onGet(async () => {
        debugGet(TargetHeatingCoolingState, this.#service);
        const data = await this.#read();
        const hvacMode = getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, this.#modeProp);
        const authorization = getTydomDataPropValue<TydomDeviceThermostatAuthorization>(
          data,
          "authorization",
        );
        let nextValue: number = TargetHeatingCoolingState.OFF;
        if (hvacMode === "NORMAL" && authorization === "HEATING") {
          nextValue = TargetHeatingCoolingState.HEAT;
        } else if (hvacMode === "NORMAL" && authorization === "COOLING") {
          nextValue = TargetHeatingCoolingState.COOL;
        }
        debugGetResult(TargetHeatingCoolingState, this.#service, nextValue);
        return nextValue;
      })
      .onSet(async (value) => {
        debugSet(TargetHeatingCoolingState, this.#service, value);
        const wantsCool = this.#canCool && value === TargetHeatingCoolingState.COOL;
        const isOn =
          wantsCool ||
          [TargetHeatingCoolingState.HEAT, TargetHeatingCoolingState.AUTO].includes(
            value as number,
          );
        const hvacMode = isOn ? "NORMAL" : "STOP";

        // `authorization` is written only by a device that advertises cooling.
        // On a radiator this stays a single-property write, exactly as before —
        // whether the gateway even accepts a write to `authorization` is
        // untested on hardware that has no use for one.
        const values: { name: string; value: unknown }[] = [
          { name: this.#modeProp, value: hvacMode },
        ];
        if (this.#canCool) {
          values.push({
            name: "authorization",
            value: isOn ? (wantsCool ? "COOLING" : "HEATING") : "STOP",
          });
        }
        await this.api.putDeviceData(this.deviceId, this.endpointId, values);
        debugSetResult(TargetHeatingCoolingState, this.#service, value, hvacMode);

        // The gateway does not echo a current-state change, so reflect it now.
        const current = wantsCool
          ? CurrentHeatingCoolingState.COOL
          : isOn
            ? CurrentHeatingCoolingState.HEAT
            : CurrentHeatingCoolingState.OFF;
        this.#service.getCharacteristic(CurrentHeatingCoolingState).updateValue(current);
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
        const data = await this.#read();
        // A device driven by thermic levels rather than a temperature — a towel
        // rail, typically — reports `setpoint: null` permanently. The push path
        // has always guarded that; this one did not, so every read handed HomeKit
        // a null and HAP logged "supplied illegal value: null".
        //
        // Falling back to the measured temperature reads as "no demand", which
        // is what a device with no setpoint actually means. Returning the
        // characteristic's own value instead would just replay whatever null
        // HomeKit was given first.
        const setpoint =
          getTydomDataPropValue<number | null>(data, "setpoint") ??
          getTydomDataPropValue<number>(data, "temperature");
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
            // A mode change the panel volunteered, on hardware that has modes
            // to change between. Heat-only devices keep the previous
            // behaviour of ignoring everything but STOP.
            if (this.#canCool && (value === "COOLING" || value === "HEATING")) {
              const next =
                value === "COOLING"
                  ? TargetHeatingCoolingState.COOL
                  : TargetHeatingCoolingState.HEAT;
              debugSetUpdate(TargetHeatingCoolingState, this.#service, next);
              this.#service.updateCharacteristic(TargetHeatingCoolingState, next);
            }
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
        // Both names are accepted: only one of them ever arrives, and which
        // depends on the firmware rather than on anything worth branching on.
        case "hvacMode":
        case "localMode": {
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
    await this.api.putDeviceData(this.deviceId, this.endpointId, [{ name: this.#modeProp, value }]);
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
            ? getTydomDataPropValue<TydomDeviceThermostatHvacMode>(data, this.#modeProp) ===
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
