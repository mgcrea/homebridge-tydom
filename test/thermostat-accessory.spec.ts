import { describe, expect, it } from "vitest";
import { ThermostatAccessory } from "../src/accessories/thermostat-accessory.js";
import { createAccessoryHarness, meta, type TydomProp } from "./accessory-harness.js";

/** The six thermic levels the hardware can offer. */
const ALL_LEVELS = ["ECO", "MODERATO", "MEDIO", "COMFORT", "STOP", "ANTI_FROST"];

const mount = (data: TydomProp[], levels: string[] = ALL_LEVELS) => {
  const harness = createAccessoryHarness({
    data,
    metadata: [meta("thermicLevel", levels), meta("hvacMode", ["NORMAL", "STOP", "ANTI_FROST"])],
  });
  const handler = new ThermostatAccessory(harness.deps);
  return { ...harness, handler, service: harness.serviceOf(harness.hap.Service.Thermostat) };
};

/**
 * A reversible unit: its metadata advertises COOLING among the authorizations
 * it accepts, which is the only thing that distinguishes it from a radiator.
 */
const mountReversible = (data: TydomProp[]) => {
  const harness = createAccessoryHarness({
    data,
    metadata: [
      meta("thermicLevel", ALL_LEVELS),
      meta("hvacMode", ["NORMAL", "STOP", "ANTI_FROST"]),
      meta("authorization", ["STOP", "HEATING", "COOLING"]),
    ],
  });
  const handler = new ThermostatAccessory(harness.deps);
  return { ...harness, handler, service: harness.serviceOf(harness.hap.Service.Thermostat) };
};

/** A device that heats to a setpoint, in the state the arguments describe. */
const heating = (over: Partial<Record<string, unknown>> = {}): TydomProp[] =>
  Object.entries({
    authorization: "HEATING",
    hvacMode: "NORMAL",
    setpoint: 21,
    temperature: 19,
    thermicLevel: "COMFORT",
    ...over,
  }).map(([name, value]) => ({ name, value }));

describe("ThermostatAccessory", () => {
  describe("current heating state", () => {
    it("reports HEAT while it is calling for heat", async () => {
      const { service, hap } = mount(heating());
      const c = service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.CurrentHeatingCoolingState.HEAT);
    });

    it("reports OFF once the room has reached the setpoint", async () => {
      // Authorised to heat, but not currently doing so.
      const { service, hap } = mount(heating({ setpoint: 19, temperature: 21 }));
      const c = service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.CurrentHeatingCoolingState.OFF);
    });

    it("reports OFF when heating is not authorised", async () => {
      const { service, hap } = mount(heating({ authorization: "STOP" }));
      const c = service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.CurrentHeatingCoolingState.OFF);
    });

    it("offers only OFF and HEAT", () => {
      // These devices only heat; COOL and AUTO are deliberately not offered.
      const { service, hap } = mount(heating());
      const c = service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState);
      expect(c.props["validValues"]).toEqual([0, 1]);
    });
  });

  describe("target heating state", () => {
    it("reports HEAT when authorised and in normal mode", async () => {
      const { service, hap } = mount(heating());
      const c = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.TargetHeatingCoolingState.HEAT);
    });

    it("reports OFF in anti-frost, which is not a HomeKit mode", async () => {
      const { service, hap } = mount(heating({ hvacMode: "ANTI_FROST" }));
      const c = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.TargetHeatingCoolingState.OFF);
    });

    it("turns the device on by writing the hvac mode", async () => {
      const { service, puts, hap } = mount(heating());
      const { TargetHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.HEAT);
      expect(puts).toEqual([[{ name: "hvacMode", value: "NORMAL" }]]);
    });

    it("turns it off by writing STOP", async () => {
      const { service, puts, hap } = mount(heating());
      const { TargetHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.OFF);
      expect(puts).toEqual([[{ name: "hvacMode", value: "STOP" }]]);
    });

    it("reflects the current state itself, since the gateway does not echo one", async () => {
      const { service, hap } = mount(heating());
      const { TargetHeatingCoolingState, CurrentHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.HEAT);
      expect(service.currentValue(CurrentHeatingCoolingState)).toBe(
        CurrentHeatingCoolingState.HEAT,
      );
    });
  });

  describe("temperature", () => {
    it("reads the measured temperature", async () => {
      const { service, hap } = mount(heating({ temperature: 18.5 }));
      expect(
        await service.getCharacteristic(hap.Characteristic.CurrentTemperature).handleGet(),
      ).toBe(18.5);
    });

    it("reads the setpoint as the target", async () => {
      const { service, hap } = mount(heating({ setpoint: 22 }));
      expect(
        await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleGet(),
      ).toBe(22);
    });

    it("falls back to the measured temperature when there is no setpoint", async () => {
      // A towel rail driven by thermic levels reports `setpoint: null`
      // permanently, and HAP rejects a null with a warning on every query.
      const { service, hap } = mount(heating({ setpoint: null, temperature: 20 }));
      expect(
        await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleGet(),
      ).toBe(20);
    });

    it("writes a new setpoint", async () => {
      const { service, puts, hap } = mount(heating());
      await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleSet(23);
      expect(puts).toEqual([[{ name: "setpoint", value: 23 }]]);
    });
  });

  describe("pushed updates", () => {
    it("turns both states off when the panel withdraws authorisation", () => {
      const { handler, service, hap } = mount(heating());
      const { CurrentHeatingCoolingState, TargetHeatingCoolingState } = hap.Characteristic;
      handler.update([{ name: "authorization", value: "STOP" }], "data");
      expect(service.currentValue(CurrentHeatingCoolingState)).toBe(CurrentHeatingCoolingState.OFF);
      expect(service.currentValue(TargetHeatingCoolingState)).toBe(TargetHeatingCoolingState.OFF);
    });

    it("moves the measured temperature", () => {
      const { handler, service, hap } = mount(heating());
      handler.update([{ name: "temperature", value: 17.5 }], "data");
      expect(service.currentValue(hap.Characteristic.CurrentTemperature)).toBe(17.5);
    });

    it("ignores a null setpoint rather than handing HAP one", () => {
      const { handler, service, hap } = mount(heating());
      handler.update([{ name: "setpoint", value: null }], "data");
      expect(service.currentValue(hap.Characteristic.TargetTemperature)).toBeUndefined();
    });
  });

  describe("thermic level switches", () => {
    it("publishes one switch per exposed level, not all six", () => {
      // Publishing every level buries the thermostat under switches.
      const { accessory } = mount(heating());
      const subtypes = accessory.services
        .filter((s) => s.serviceName === "Switch")
        .map((s) => s.subtype);
      expect(subtypes.toSorted()).toEqual([
        "thermicLevel_anti_frost",
        "thermicLevel_comfort",
        "thermicLevel_eco",
      ]);
    });

    it("publishes only an absence switch when the device offers one level", () => {
      const { accessory } = mount(heating(), ["STOP"]);
      const subtypes = accessory.services
        .filter((s) => s.serviceName === "Switch")
        .map((s) => s.subtype);
      expect(subtypes).toEqual(["hvacMode_absence"]);
    });

    it("lights exactly one switch when a level is pushed", () => {
      // Turning one on without turning the others off left two mutually
      // exclusive modes both lit in the Home app.
      const { handler, accessory, hap } = mount(heating());
      handler.update([{ name: "thermicLevel", value: "ECO" }], "data");
      const on = accessory.services
        .filter((s) => s.serviceName === "Switch")
        .filter((s) => s.currentValue(hap.Characteristic.On) === true)
        .map((s) => s.subtype);
      expect(on).toEqual(["thermicLevel_eco"]);
    });

    it("reports the failure when metadata carries no thermic levels", () => {
      const harness = createAccessoryHarness({ data: heating(), metadata: [] });
      const handler = new ThermostatAccessory(harness.deps);
      expect(handler).toBeDefined();
      expect(harness.messages.join("\n")).toMatch(/no "thermicLevel" entry/);
    });
  });

  describe("reversible units (cooling)", () => {
    it("offers COOL only when the metadata advertises it", () => {
      // A radiator getting a Cool button would put a control in the Home app
      // that silently does nothing.
      const { service, hap } = mountReversible(heating());
      const target = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
      const current = service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState);
      expect(target.props["validValues"]).toEqual([0, 1, 2]);
      expect(current.props["validValues"]).toEqual([0, 1, 2]);
    });

    it("reports COOL while it is actively cooling", async () => {
      const { service, hap } = mountReversible(
        heating({ authorization: "COOLING", temperature: 26, setpoint: 22 }),
      );
      const c = service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.CurrentHeatingCoolingState.COOL);
    });

    it("reports OFF once it has cooled to the setpoint", async () => {
      // Symmetrical with the heating case: this characteristic says what the
      // unit is doing, not what it is permitted to do.
      const { service, hap } = mountReversible(
        heating({ authorization: "COOLING", temperature: 21, setpoint: 22 }),
      );
      const c = service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.CurrentHeatingCoolingState.OFF);
    });

    it("reports COOL as the target when authorised to cool", async () => {
      const { service, hap } = mountReversible(heating({ authorization: "COOLING" }));
      const c = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.TargetHeatingCoolingState.COOL);
    });

    it("writes the authorization alongside the mode when asked to cool", async () => {
      const { service, puts, hap } = mountReversible(heating());
      const { TargetHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.COOL);
      expect(puts).toEqual([
        [
          { name: "hvacMode", value: "NORMAL" },
          { name: "authorization", value: "COOLING" },
        ],
      ]);
    });

    it("switches back to heating", async () => {
      const { service, puts, hap } = mountReversible(heating({ authorization: "COOLING" }));
      const { TargetHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.HEAT);
      expect(puts[0]).toContainEqual({ name: "authorization", value: "HEATING" });
    });

    it("stops both when turned off", async () => {
      const { service, puts, hap } = mountReversible(heating({ authorization: "COOLING" }));
      const { TargetHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.OFF);
      expect(puts[0]).toEqual([
        { name: "hvacMode", value: "STOP" },
        { name: "authorization", value: "STOP" },
      ]);
    });

    it("reflects COOL immediately, since the gateway does not echo one", async () => {
      const { service, hap } = mountReversible(heating());
      const { TargetHeatingCoolingState, CurrentHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.COOL);
      expect(service.currentValue(CurrentHeatingCoolingState)).toBe(
        CurrentHeatingCoolingState.COOL,
      );
    });

    it("follows a mode change made from the Tydom app", () => {
      const { handler, service, hap } = mountReversible(heating());
      const { TargetHeatingCoolingState } = hap.Characteristic;
      handler.update([{ name: "authorization", value: "COOLING" }], "data");
      expect(service.currentValue(TargetHeatingCoolingState)).toBe(TargetHeatingCoolingState.COOL);
    });
  });

  describe("a heat-only device is untouched by any of this", () => {
    it("never writes an authorization", async () => {
      // Whether the gateway accepts a write to `authorization` on hardware with
      // no use for one is untested, so a radiator keeps its single-property
      // write exactly as before.
      const { service, puts, hap } = mount(heating());
      const { TargetHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.HEAT);
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.OFF);
      expect(puts.flat().map((p) => p.name)).toEqual(["hvacMode", "hvacMode"]);
    });

    it("ignores a COOLING push it has no way to represent", () => {
      const { handler, service, hap } = mount(heating());
      handler.update([{ name: "authorization", value: "COOLING" }], "data");
      expect(service.currentValue(hap.Characteristic.TargetHeatingCoolingState)).toBeUndefined();
    });
  });

  describe("newer firmware that renamed hvacMode to localMode (#185)", () => {
    /**
     * A Tybox 5100, from the metadata dump in #185.
     *
     * The salient part is what is missing: there is no `hvacMode` at all. The
     * mode moved to `localMode`, which carries the same three values plus
     * `ABSENCE`. `thermicLevel` narrowed to two values on this hardware.
     */
    const TYBOX_5100_METADATA = [
      meta("authorization", ["STOP", "HEATING"]),
      meta("comfortMode", ["STOP", "HEATING"]),
      meta("thermicLevel", ["STOP", "ANTI_FROST"]),
      meta("localMode", ["NORMAL", "STOP", "ANTI_FROST", "ABSENCE"]),
      meta("useMode", ["SCHED", "OVERRIDE", "MANUAL"]),
    ];

    const mountTybox = (over: Record<string, unknown> = {}) => {
      const data = Object.entries({
        authorization: "HEATING",
        localMode: "NORMAL",
        setpoint: 21,
        temperature: 19,
        thermicLevel: "STOP",
        ...over,
      }).map(([name, value]) => ({ name, value }));
      const harness = createAccessoryHarness({ data, metadata: TYBOX_5100_METADATA });
      const handler = new ThermostatAccessory(harness.deps);
      return { ...harness, handler, service: harness.serviceOf(harness.hap.Service.Thermostat) };
    };

    it("reads the target state instead of throwing", async () => {
      // The reported bug: `getTydomDataPropValue` asserts on a missing
      // property, so every read failed with
      // `Missing property with name="hvacMode" in endpoint data` and the
      // accessory errored on every HomeKit query.
      const { service, hap } = mountTybox();
      const c = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
      await expect(c.handleGet()).resolves.toBe(hap.Characteristic.TargetHeatingCoolingState.HEAT);
    });

    it("writes localMode rather than hvacMode", async () => {
      const { service, puts, hap } = mountTybox();
      const { TargetHeatingCoolingState } = hap.Characteristic;
      await service
        .getCharacteristic(TargetHeatingCoolingState)
        .handleSet(TargetHeatingCoolingState.OFF);
      expect(puts).toEqual([[{ name: "localMode", value: "STOP" }]]);
    });

    it("treats ABSENCE — which hvacMode never had — as off", async () => {
      const { service, hap } = mountTybox({ localMode: "ABSENCE" });
      const c = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
      expect(await c.handleGet()).toBe(hap.Characteristic.TargetHeatingCoolingState.OFF);
    });

    it("follows a localMode change pushed by the gateway", () => {
      const { handler, service, hap } = mountTybox();
      const { TargetHeatingCoolingState } = hap.Characteristic;
      handler.update([{ name: "localMode", value: "ANTI_FROST" }], "data");
      expect(service.currentValue(TargetHeatingCoolingState)).toBe(TargetHeatingCoolingState.OFF);
    });

    it("still reads temperature and setpoint, which did not move", async () => {
      const { service, hap } = mountTybox({ temperature: 18, setpoint: 22 });
      expect(
        await service.getCharacteristic(hap.Characteristic.CurrentTemperature).handleGet(),
      ).toBe(18);
      expect(
        await service.getCharacteristic(hap.Characteristic.TargetTemperature).handleGet(),
      ).toBe(22);
    });

    it("drives its anti-frost switch off localMode", async () => {
      const { accessory, hap } = mountTybox({ localMode: "ANTI_FROST" });
      const sub = accessory.services.find((s) => s.serviceName === "Switch");
      expect(sub?.subtype).toBe("thermicLevel_anti_frost");
      // The switch reads `thermicLevel` for a named level, so it reports off
      // here — what matters is that resolving it no longer throws.
      await expect(sub!.getCharacteristic(hap.Characteristic.On).handleGet()).resolves.toBe(false);
    });

    it("does not offer cooling, since its authorization has no COOLING", () => {
      const { service, hap } = mountTybox();
      expect(
        service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).props[
          "validValues"
        ],
      ).toEqual([0, 1]);
    });

    it("prefers hvacMode when a device somehow advertises both", async () => {
      // Nothing changes for hardware that already worked.
      const harness = createAccessoryHarness({
        data: [
          { name: "authorization", value: "HEATING" },
          { name: "hvacMode", value: "NORMAL" },
          { name: "localMode", value: "STOP" },
          { name: "setpoint", value: 21 },
          { name: "temperature", value: 19 },
        ],
        metadata: [...TYBOX_5100_METADATA, meta("hvacMode", ["NORMAL", "STOP", "ANTI_FROST"])],
      });
      const handler = new ThermostatAccessory(harness.deps);
      expect(handler).toBeDefined();
      const service = harness.serviceOf(harness.hap.Service.Thermostat);
      const { TargetHeatingCoolingState } = harness.hap.Characteristic;
      expect(await service.getCharacteristic(TargetHeatingCoolingState).handleGet()).toBe(
        TargetHeatingCoolingState.HEAT,
      );
    });

    it("warns when a thermostat advertises neither property", () => {
      const harness = createAccessoryHarness({
        data: [],
        metadata: [meta("thermicLevel", ["STOP", "ANTI_FROST"])],
      });
      const handler = new ThermostatAccessory(harness.deps);
      expect(handler).toBeDefined();
      expect(harness.messages.join("\n")).toMatch(/advertises neither/);
    });
  });
});
