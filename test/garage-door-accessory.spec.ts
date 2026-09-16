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
});
