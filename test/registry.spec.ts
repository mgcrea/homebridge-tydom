import { describe, expect, it } from "vitest";
import { CATEGORY, deviceTypeForCategory, type DeviceType } from "../src/api/device-type.js";
import { ACCESSORY_REGISTRY } from "../src/accessories/registry.js";

/**
 * Every device type resolution can produce, and every type a cached accessory's
 * category can be mapped back to, must have a handler. TypeScript enforces the
 * first half at compile time; this covers the second, and catches a device type
 * that is declared but that nothing can ever actually produce.
 */
const ALL_DEVICE_TYPES: DeviceType[] = [
  "alarm",
  "alarm-sensors",
  "contact-sensor",
  "fan",
  "garage-door",
  "light-sensor",
  "lightbulb",
  "lightbulb-switchable",
  "outlet",
  "smoke-detector",
  "switch",
  "temperature-sensor",
  "thermostat",
  "trigger-switch",
  "window-covering",
];

describe("ACCESSORY_REGISTRY", () => {
  it("has a factory for every device type", () => {
    for (const deviceType of ALL_DEVICE_TYPES) {
      expect(ACCESSORY_REGISTRY[deviceType], `missing handler for ${deviceType}`).toBeTypeOf(
        "function",
      );
    }
  });

  it("declares no handlers for types that are not in the union", () => {
    expect(Object.keys(ACCESSORY_REGISTRY).toSorted()).toEqual(ALL_DEVICE_TYPES.toSorted());
  });

  it("has a handler for every category a cached accessory could carry", () => {
    // A user upgrading from an earlier release has cached accessories with a
    // category but no deviceType; the platform derives one. Every category the
    // old dispatch switches accepted must still land on a handler.
    const categories = [
      CATEGORY.LIGHTBULB,
      CATEGORY.OUTLET,
      CATEGORY.THERMOSTAT,
      CATEGORY.FAN,
      CATEGORY.GARAGE_DOOR_OPENER,
      CATEGORY.SWITCH,
      CATEGORY.WINDOW_COVERING,
      CATEGORY.SECURITY_SYSTEM,
      CATEGORY.SENSOR,
      CATEGORY.WINDOW,
      CATEGORY.DOOR,
      CATEGORY.ALARM_SENSORS,
    ];
    for (const category of categories) {
      const deviceType = deviceTypeForCategory(category);
      expect(deviceType, `category ${category} maps to nothing`).toBeDefined();
      expect(ACCESSORY_REGISTRY[deviceType as DeviceType]).toBeTypeOf("function");
    }
  });
});
