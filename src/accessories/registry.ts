import type { AccessoryRegistry } from "./base.js";
import { setupContactSensor, updateContactSensor } from "./contactSensor.js";
import { setupFan, updateFan } from "./fan.js";
import { setupGarageDoorOpener, updateGarageDoorOpener } from "./garageDoorOpener.js";
import { fromFunctionPair } from "./legacy-adapter.js";
import { setupLightbulb, updateLightbulb } from "./lightbulb.js";
import { setupOutlet, updateOutlet } from "./outlet.js";
import { setupSecuritySystem, updateSecuritySystem } from "./securitySystem.js";
import {
  setupSecuritySystemSensors,
  updateSecuritySystemSensors,
} from "./securitySystemSensors.js";
import { setupSmokeDetector, updateSmokeDetector } from "./smokeDetector.js";
import { setupSwitch, updateSwitch } from "./switch.js";
import { setupTemperatureSensor, updateTemperatureSensor } from "./temperatureSensor.js";
import { setupThermostat, updateThermostat } from "./thermostat.js";
import { setupTriggerSwitch, updateTriggerSwitch } from "./triggerSwitch.js";
import { setupWindowCovering, updateWindowCovering } from "./windowCovering.js";

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
  "contact-sensor": fromFunctionPair(setupContactSensor, updateContactSensor),
  fan: fromFunctionPair(setupFan, updateFan),
  "garage-door": fromFunctionPair(setupGarageDoorOpener, updateGarageDoorOpener),
  lightbulb: fromFunctionPair(setupLightbulb, updateLightbulb),
  // Dimmable and switchable lights still share one module, which branches
  // internally on level.step. Phase 6.1 splits them.
  "lightbulb-switchable": fromFunctionPair(setupLightbulb, updateLightbulb),
  outlet: fromFunctionPair(setupOutlet, updateOutlet),
  "smoke-detector": fromFunctionPair(setupSmokeDetector, updateSmokeDetector),
  switch: fromFunctionPair(setupSwitch, updateSwitch),
  "temperature-sensor": fromFunctionPair(setupTemperatureSensor, updateTemperatureSensor),
  thermostat: fromFunctionPair(setupThermostat, updateThermostat),
  "trigger-switch": fromFunctionPair(setupTriggerSwitch, updateTriggerSwitch),
  "window-covering": fromFunctionPair(setupWindowCovering, updateWindowCovering),
};
