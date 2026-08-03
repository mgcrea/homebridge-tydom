import type { AccessoryRegistry } from "./base.js";
import { createContactSensorAccessory } from "./contact-sensor-accessory.js";
import { createGarageDoorAccessory } from "./garage-door-accessory.js";
import { fromFunctionPair } from "./legacy-adapter.js";
import { createLightbulbAccessory } from "./lightbulb-accessory.js";
import { createOutletAccessory } from "./outlet-accessory.js";
import { createSmokeDetectorAccessory } from "./smoke-detector-accessory.js";
import { createTemperatureSensorAccessory } from "./temperature-sensor-accessory.js";
import { createThermostatAccessory } from "./thermostat-accessory.js";
import { createTriggerSwitchAccessory } from "./trigger-switch-accessory.js";
import { createWindowCoveringAccessory } from "./window-covering-accessory.js";
import {
  createFanAccessory,
  createSwitchableLightbulbAccessory,
  createSwitchAccessory,
} from "./switchable-accessory.js";
import { setupSecuritySystem, updateSecuritySystem } from "./securitySystem.js";
import {
  setupSecuritySystemSensors,
  updateSecuritySystemSensors,
} from "./securitySystemSensors.js";

/**
 * The one place a device type is mapped to an implementation.
 *
 * This replaces two parallel switch statements that had to be kept in lockstep
 * by hand — one picking a setup function, one picking an update function, each
 * ending in a `default: throw new Error("Unsupported accessory category")`.
 * Because `AccessoryRegistry` is `Record<DeviceType, AccessoryFactory>`, adding
 * a device type without a handler is now a compile error rather than a runtime
 * one, and the two halves cannot drift apart.
 *
 * Entries move off `fromFunctionPair` one at a time as phase 6 converts each
 * module to a class.
 */
export const ACCESSORY_REGISTRY: AccessoryRegistry = {
  alarm: fromFunctionPair(setupSecuritySystem, updateSecuritySystem),
  "alarm-sensors": fromFunctionPair(setupSecuritySystemSensors, updateSecuritySystemSensors),
  "contact-sensor": createContactSensorAccessory,
  fan: createFanAccessory,
  "garage-door": createGarageDoorAccessory,
  lightbulb: createLightbulbAccessory,
  "lightbulb-switchable": createSwitchableLightbulbAccessory,
  outlet: createOutletAccessory,
  "smoke-detector": createSmokeDetectorAccessory,
  switch: createSwitchAccessory,
  "temperature-sensor": createTemperatureSensorAccessory,
  thermostat: createThermostatAccessory,
  "trigger-switch": createTriggerSwitchAccessory,
  "window-covering": createWindowCoveringAccessory,
};
