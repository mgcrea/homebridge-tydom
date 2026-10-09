import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GarageDoorAccessory } from "../src/accessories/garage-door-accessory.js";
import { createAccessoryHarness, meta } from "./accessory-harness.js";

/** A gate whose driver only accepts TOGGLE, like a Tydom-driven portail. */
const mountToggleOnly = () => {
  const harness = createAccessoryHarness({
    data: [{ name: "level", value: 0 }],
    metadata: [meta("levelCmd", ["TOGGLE"])],
  });
  const handler = new GarageDoorAccessory(harness.deps);
  const service = harness.serviceOf(harness.hap.Service.GarageDoorOpener);
  const { CurrentDoorState, TargetDoorState } = harness.hap.Characteristic;
  return {
    ...harness,
    handler,
    current: service.getCharacteristic(CurrentDoorState),
    target: service.getCharacteristic(TargetDoorState),
  };
};

/** A gate configured to close itself again a while after it opens. */
const mountAutoClosing = (autoCloseDelay: number) => {
  const harness = createAccessoryHarness({
    data: [{ name: "level", value: 0 }],
    metadata: [meta("levelCmd", ["TOGGLE"])],
    settings: { autoCloseDelay },
  });
  const handler = new GarageDoorAccessory(harness.deps);
  const service = harness.serviceOf(harness.hap.Service.GarageDoorOpener);
  const { CurrentDoorState, TargetDoorState } = harness.hap.Characteristic;
  return {
    ...harness,
    handler,
    current: service.getCharacteristic(CurrentDoorState),
    target: service.getCharacteristic(TargetDoorState),
  };
};

describe("GarageDoorAccessory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("toggle-only drivers", () => {
    it("reports OPEN as the target while the gate is opening", async () => {
      const { hap, current, target, puts } = mountToggleOnly();
      const { CurrentDoorState, TargetDoorState } = hap.Characteristic;

      await target.handleSet(TargetDoorState.OPEN);

      expect(puts).toEqual([[{ name: "levelCmd", value: "TOGGLE" }]]);
      expect(await current.handleGet()).toBe(CurrentDoorState.OPENING);
      // TargetDoorState only admits OPEN and CLOSED; answering with OPENING
      // made HAP reject the value.
      expect(await target.handleGet()).toBe(TargetDoorState.OPEN);
    });

    it("reports CLOSED as the target while the gate is closing", async () => {
      const { hap, current, target } = mountToggleOnly();
      const { CurrentDoorState, TargetDoorState } = hap.Characteristic;

      await target.handleSet(TargetDoorState.OPEN);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await current.handleGet()).toBe(CurrentDoorState.OPEN);

      await target.handleSet(TargetDoorState.CLOSED);

      expect(await current.handleGet()).toBe(CurrentDoorState.CLOSING);
      expect(await target.handleGet()).toBe(TargetDoorState.CLOSED);
    });

    it("keeps the last requested target once the gate is stopped", async () => {
      const { hap, current, target } = mountToggleOnly();
      const { CurrentDoorState, TargetDoorState } = hap.Characteristic;

      await target.handleSet(TargetDoorState.OPEN);
      // Commanding a moving gate stops it, then reverses after a pause.
      const reversing = target.handleSet(TargetDoorState.CLOSED);
      await vi.advanceTimersByTimeAsync(0);
      expect(await current.handleGet()).toBe(CurrentDoorState.STOPPED);
      expect(await target.handleGet()).toBe(TargetDoorState.CLOSED);
      await vi.advanceTimersByTimeAsync(1_000);
      await reversing;

      expect(await current.handleGet()).toBe(CurrentDoorState.CLOSING);
      expect(await target.handleGet()).toBe(TargetDoorState.CLOSED);
    });
  });

  /**
   * The auto-close is the plugin's own decision, not the user's, so HomeKit has
   * to be told the target moved. It only ever heard the OPEN the user wrote,
   * and the accessory pushed the new current state without the new target —
   * leaving the Home app showing a door that is open and headed open, forever.
   * Reported in https://github.com/mgcrea/homebridge-tydom/pull/153.
   */
  describe("auto-close", () => {
    it("tells HomeKit the target closed, not just the current state", async () => {
      const { hap, current, target } = mountAutoClosing(300_000);
      const { CurrentDoorState, TargetDoorState } = hap.Characteristic;

      await target.handleSet(TargetDoorState.OPEN);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(current.value).toBe(CurrentDoorState.OPEN);
      expect(target.value).toBe(TargetDoorState.OPEN);

      await vi.advanceTimersByTimeAsync(300_000);

      expect(current.value).toBe(CurrentDoorState.CLOSED);
      expect(target.value).toBe(TargetDoorState.CLOSED);
    });
  });
});
