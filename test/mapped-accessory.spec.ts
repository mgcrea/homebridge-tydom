import { describe, expect, it } from "vitest";
import { MappedAccessory, type AccessorySpec } from "../src/accessories/mapped-accessory.js";
import type { AccessoryDeps } from "../src/accessories/base.js";
import {
  contactSensorSpec,
  fanSpec,
  lightSensorSpec,
  outletSpec,
  smokeDetectorSpec,
  switchableLightbulbSpec,
  switchSpec,
  temperatureSensorSpec,
} from "../src/accessories/specs.js";
import { createHapStatics, FakeAccessory, type FakeService } from "./hap-double.js";

type TydomProp = { name: string; value: unknown };

/**
 * Stand an accessory up against the HAP double.
 *
 * `data` is the endpoint snapshot the gateway would answer a read with; `puts`
 * records everything written back.
 */
const mount = (
  spec: AccessorySpec,
  data: TydomProp[],
  // Passed in to rebuild a handler against an accessory that already exists,
  // which is what the platform does when a device's category changes.
  existing?: { accessory: FakeAccessory; hap: ReturnType<typeof createHapStatics> },
) => {
  const hap = existing?.hap ?? createHapStatics();
  const accessory = existing?.accessory ?? new FakeAccessory("Test Device", "uuid:test");
  Object.assign(accessory.context, { deviceId: 1, endpointId: 2 });
  const puts: TydomProp[][] = [];

  const deps = {
    platform: {
      Service: hap.Service,
      Characteristic: hap.Characteristic,
      config: { staleAfterMs: 0 },
      log: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    },
    accessory,
    api: {
      getDeviceData: async () => data,
      putDeviceData: async (_deviceId: number, _endpointId: number, values: TydomProp[]) => {
        puts.push(values);
      },
    },
    t: (key: string) => key,
    notify: () => {},
  } as unknown as AccessoryDeps;

  const handler = new MappedAccessory(deps, spec);
  return {
    handler,
    accessory,
    puts,
    hap,
    service: handler.publishedService as unknown as FakeService,
  };
};

describe("the HAP double itself", () => {
  it("mints identity-stable classes", () => {
    const hap = createHapStatics();
    expect(hap.Service.Outlet).toBe(hap.Service.Outlet);
    expect(hap.Service.Outlet).not.toBe(hap.Service.Switch);
  });

  it("refuses to hand out a constant it has not seeded", () => {
    // Without this the double returns undefined, an assertion against undefined
    // succeeds, and a wrong mapping ships green. Guarding it is what makes the
    // rest of this file worth trusting.
    const hap = createHapStatics();
    expect(() => hap.Characteristic.TargetHeaterCoolerState.HEAT).toThrow(/not seeded/);
    expect(hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW).toBe(1);
  });

  it("still exposes the ordinary class members", () => {
    const hap = createHapStatics();
    expect(hap.Characteristic.ContactSensorState.name).toBe("ContactSensorState");
  });
});

describe("MappedAccessory", () => {
  describe("contact sensor", () => {
    it("reads the intrusion flag", async () => {
      const { service, hap } = mount(contactSensorSpec, [{ name: "intrusionDetect", value: true }]);
      const state = service.getCharacteristic(hap.Characteristic.ContactSensorState);
      expect(await state.handleGet()).toBe(true);
    });

    it("is read-only", () => {
      const { service, hap } = mount(contactSensorSpec, []);
      expect(service.getCharacteristic(hap.Characteristic.ContactSensorState).writable).toBe(false);
    });

    it("applies a pushed change", () => {
      const { handler, service, hap } = mount(contactSensorSpec, []);
      handler.update([{ name: "intrusionDetect", value: true }], "data");
      expect(service.currentValue(hap.Characteristic.ContactSensorState)).toBe(true);
    });

    it("ignores a property it does not map", () => {
      const { handler, service, hap } = mount(contactSensorSpec, []);
      handler.update([{ name: "battDefect", value: true }], "data");
      expect(service.currentValue(hap.Characteristic.ContactSensorState)).toBeUndefined();
    });
  });

  describe("temperature sensor", () => {
    it("reads the outdoor temperature", async () => {
      const { service, hap } = mount(temperatureSensorSpec, [
        { name: "outTemperature", value: -12.5 },
      ]);
      expect(
        await service.getCharacteristic(hap.Characteristic.CurrentTemperature).handleGet(),
      ).toBe(-12.5);
    });

    it("widens the floor below freezing", () => {
      // HAP defaults to 0 °C, which a French winter goes below.
      const { service, hap } = mount(temperatureSensorSpec, []);
      expect(service.getCharacteristic(hap.Characteristic.CurrentTemperature).props).toMatchObject({
        minValue: -100,
      });
    });
  });

  describe("light sensor", () => {
    it("reads the ambient light level", async () => {
      const { service, hap } = mount(lightSensorSpec, [{ name: "lightPower", value: 42 }]);
      expect(
        await service.getCharacteristic(hap.Characteristic.CurrentAmbientLightLevel).handleGet(),
      ).toBe(42);
    });

    it("widens the floor below HAP's default", () => {
      // HAP defaults to a 0.0001 lux floor, which full darkness (0 lux) goes below.
      const { service, hap } = mount(lightSensorSpec, []);
      expect(
        service.getCharacteristic(hap.Characteristic.CurrentAmbientLightLevel).props,
      ).toMatchObject({
        minValue: 0,
      });
    });
  });

  describe("smoke detector", () => {
    it("reads the smoke flag as a bool", async () => {
      const { service, hap } = mount(smokeDetectorSpec, [
        { name: "techSmokeDefect", value: true },
        { name: "battDefect", value: false },
      ]);
      const smoke = service.getCharacteristic(hap.Characteristic.SmokeDetected);
      expect(await smoke.handleGet()).toBe(true);
      expect(smoke.props).toMatchObject({ format: "bool" });
    });

    it("maps the battery flag onto the HAP constants on read and on push alike", async () => {
      // The two paths used to carry separate copies of this mapping and had
      // drifted: a push wrote the raw boolean while the read mapped it. It
      // happened to work only because `true` coerces to 1.
      const { handler, service, hap } = mount(smokeDetectorSpec, [
        { name: "techSmokeDefect", value: false },
        { name: "battDefect", value: true },
      ]);
      const battery = service.getCharacteristic(hap.Characteristic.StatusLowBattery);
      const fromRead = await battery.handleGet();
      expect(fromRead).toBe(hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);

      handler.update([{ name: "battDefect", value: true }], "data");
      expect(service.currentValue(hap.Characteristic.StatusLowBattery)).toBe(fromRead);

      handler.update([{ name: "battDefect", value: false }], "data");
      expect(service.currentValue(hap.Characteristic.StatusLowBattery)).toBe(
        hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      );
    });
  });

  describe("outlet", () => {
    it("reads plugCmd rather than level", async () => {
      const { service, hap } = mount(outletSpec, [
        { name: "plugCmd", value: "ON" },
        { name: "energyInstantTotElecP", value: 0 },
      ]);
      expect(await service.getCharacteristic(hap.Characteristic.On).handleGet()).toBe(true);
    });

    it("writes the string the gateway expects", async () => {
      const { service, puts, hap } = mount(outletSpec, []);
      await service.getCharacteristic(hap.Characteristic.On).handleSet(true);
      expect(puts).toEqual([[{ name: "plugCmd", value: "ON" }]]);
      await service.getCharacteristic(hap.Characteristic.On).handleSet(false);
      expect(puts[1]).toEqual([{ name: "plugCmd", value: "OFF" }]);
    });

    it("also accepts a numeric level push", () => {
      // A released version compared `level` to the string "ON" — a test a
      // numeric level can never pass, so a pushed change never reached HomeKit.
      const { handler, service, hap } = mount(outletSpec, []);
      handler.update([{ name: "level", value: 100 }], "data");
      expect(service.currentValue(hap.Characteristic.On)).toBe(true);
      handler.update([{ name: "level", value: 0 }], "data");
      expect(service.currentValue(hap.Characteristic.On)).toBe(false);
    });

    it("derives in-use from instantaneous power", async () => {
      const { service, hap } = mount(outletSpec, [
        { name: "plugCmd", value: "ON" },
        { name: "energyInstantTotElecP", value: 42 },
      ]);
      expect(await service.getCharacteristic(hap.Characteristic.OutletInUse).handleGet()).toBe(
        true,
      );
    });
  });

  describe("switchable devices", () => {
    it.each([
      ["switch", switchSpec, "Switch"],
      ["fan", fanSpec, "Fan"],
      ["non-dimmable light", switchableLightbulbSpec, "Lightbulb"],
    ])("publishes %s as a %s service", (_label, spec, serviceName) => {
      const { service } = mount(spec, []);
      expect(service.serviceName).toBe(serviceName);
    });

    it("treats only a full level as on", async () => {
      const { service, hap } = mount(switchSpec, [{ name: "level", value: 100 }]);
      expect(await service.getCharacteristic(hap.Characteristic.On).handleGet()).toBe(true);
      const partial = mount(switchSpec, [{ name: "level", value: 50 }]);
      expect(
        await partial.service.getCharacteristic(partial.hap.Characteristic.On).handleGet(),
      ).toBe(false);
    });

    it("writes 0 or 100", async () => {
      const { service, puts, hap } = mount(fanSpec, []);
      await service.getCharacteristic(hap.Characteristic.On).handleSet(true);
      expect(puts).toEqual([[{ name: "level", value: 100 }]]);
    });
  });

  describe("lifecycle", () => {
    it("detaches its identify listener on dispose", () => {
      const { handler, accessory } = mount(contactSensorSpec, []);
      expect(accessory.listenerCount("identify")).toBe(1);
      handler.dispose();
      expect(accessory.listenerCount("identify")).toBe(0);
    });

    it("does not accumulate listeners across rebuilds of the same accessory", () => {
      // `configureHandler` disposes the old handler and constructs a new one
      // against the *same* PlatformAccessory when a device's category changes.
      // The listener used to be left attached, so each pass added another copy,
      // each holding its dead handler alive.
      const first = mount(contactSensorSpec, []);
      const { accessory, hap } = first;
      for (let pass = 0; pass < 5; pass++) {
        const previous = mount(contactSensorSpec, [], { accessory, hap });
        expect(accessory.listenerCount("identify")).toBe(2);
        previous.handler.dispose();
        expect(accessory.listenerCount("identify")).toBe(1);
      }
      first.handler.dispose();
      expect(accessory.listenerCount("identify")).toBe(0);
    });

    it("reuses a service across a rebuild rather than adding a second", () => {
      // The helper this replaced took a `removeExisting` flag every caller
      // passed `true`, so services were torn down and rebuilt on every launch.
      const { accessory, hap } = mount(contactSensorSpec, []);
      expect(accessory.services).toHaveLength(2); // AccessoryInformation + ContactSensor
      mount(contactSensorSpec, [], { accessory, hap });
      expect(accessory.services.filter((s) => s.serviceName === "ContactSensor")).toHaveLength(1);
      expect(accessory.services).toHaveLength(2);
    });
  });
});
