import type { AccessorySpec } from "./mapped-accessory.js";

/**
 * The device types that are nothing but a characteristic-to-property mapping.
 *
 * These were five modules of ~340 lines that differed in about five values
 * each: the service, the characteristic, the Tydom property, the conversion and
 * occasionally a `setProps`. Everything else — the two trace calls per read, the
 * `getTydomDataPropValue` lookup, the push loop that skipped every property but
 * one — was the same text copied twelve times. It now lives in
 * `MappedAccessory`, and what remains here is only what actually differs.
 */

/** A door or window opening contact (Delta Dore MDO). */
export const contactSensorSpec: AccessorySpec = {
  service: (Services) => Services.ContactSensor,
  bindings: (Characteristics) => [
    { characteristic: Characteristics.ContactSensorState, prop: "intrusionDetect" },
  ],
};

/** An outdoor probe reporting `outTemperature`. */
export const temperatureSensorSpec: AccessorySpec = {
  service: (Services) => Services.TemperatureSensor,
  bindings: (Characteristics) => [
    {
      characteristic: Characteristics.CurrentTemperature,
      prop: "outTemperature",
      // HAP defaults to a 0 °C floor, which a French winter goes below.
      props: { minValue: -100 },
    },
  ],
};

/** A standalone ambient light sensor reporting `lightPower`. */
export const lightSensorSpec: AccessorySpec = {
  service: (Services) => Services.LightSensor,
  bindings: (Characteristics) => [
    {
      characteristic: Characteristics.CurrentAmbientLightLevel,
      prop: "lightPower",
      // HAP defaults to a 0.0001 lux floor, which full darkness (0 lux) goes below.
      props: { minValue: 0 },
    },
  ],
};

/** A DFR TYXAL+ smoke detector. */
export const smokeDetectorSpec: AccessorySpec = {
  service: (Services) => Services.SmokeSensor,
  bindings: (Characteristics) => [
    {
      characteristic: Characteristics.SmokeDetected,
      prop: "techSmokeDefect",
      // The gateway reports a flag, not HAP's DETECTED/NOT_DETECTED enum.
      props: { format: "bool" },
    },
    {
      characteristic: Characteristics.StatusLowBattery,
      prop: "battDefect",
      toHomeKit: (defect: boolean) =>
        defect
          ? Characteristics.StatusLowBattery.BATTERY_LEVEL_LOW
          : Characteristics.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    },
  ],
};

/** A metering plug (Delta Dore Easy Plug). */
export const outletSpec: AccessorySpec = {
  service: (Services) => Services.Outlet,
  bindings: (Characteristics) => [
    {
      characteristic: Characteristics.On,
      prop: "plugCmd",
      toHomeKit: (value: string) => value === "ON",
      toTydom: (value) => (value ? "ON" : "OFF"),
      // A released version handled only "level" and compared it to the string
      // "ON" — a test a numeric level can never pass, so a pushed state change
      // never reached HomeKit. `plugCmd` is what this accessory reads and
      // writes; `level` is still honoured, read numerically as everywhere else.
      alsoUpdatedBy: { level: (value: unknown) => Number(value) > 0 },
    },
    {
      characteristic: Characteristics.OutletInUse,
      prop: "energyInstantTotElecP",
      toHomeKit: (power: number) => power > 0,
    },
  ],
};

/**
 * A device driven by a single `level` property that only ever reads 0 or 100.
 *
 * Three HomeKit types share this behaviour and differ only in which service
 * they publish. They were once three modules plus a shared helper — four files
 * for one behaviour — then one abstract class with three one-line subclasses.
 * Now they are one function called three times.
 */
const switchableSpec = (service: AccessorySpec["service"]): AccessorySpec => ({
  service,
  bindings: (Characteristics) => [
    {
      characteristic: Characteristics.On,
      prop: "level",
      toHomeKit: (level: number) => level === 100,
      toTydom: (value) => (value ? 100 : 0),
    },
  ],
});

export const switchSpec = switchableSpec((Services) => Services.Switch);
export const fanSpec = switchableSpec((Services) => Services.Fan);
/** A light whose driver reports `level.step === 100`, so it has no brightness. */
export const switchableLightbulbSpec = switchableSpec((Services) => Services.Lightbulb);
