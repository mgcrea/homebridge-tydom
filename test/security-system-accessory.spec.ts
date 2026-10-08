import { describe, expect, it, vi } from "vitest";
import { SecuritySystemAccessory } from "../src/accessories/security-system-accessory.js";
import { createAccessoryHarness, type TydomProp } from "./accessory-harness.js";

/** The panel in the state the arguments describe, with its services published. */
const mount = async (
  over: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
) => {
  const data: TydomProp[] = Object.entries({
    alarmState: "OFF",
    alarmMode: "OFF",
    systAutoProtect: false,
    systOpenIssue: false,
    alarmSOS: false,
    ...over,
  }).map(([name, value]) => ({ name, value }));

  const harness = createAccessoryHarness({ data, settings: { pin: "123456", ...settings } });
  const handler = new SecuritySystemAccessory(harness.deps);
  handler.start();

  const { SecuritySystem } = harness.hap.Service;
  await vi.waitFor(() => harness.serviceOf(SecuritySystem));
  const service = harness.serviceOf(SecuritySystem);
  const { SecuritySystemCurrentState, SecuritySystemTargetState } = harness.hap.Characteristic;

  return {
    ...harness,
    handler,
    service,
    current: service.getCharacteristic(SecuritySystemCurrentState),
    target: service.getCharacteristic(SecuritySystemTargetState),
  };
};

describe("SecuritySystemAccessory", () => {
  it("answers a target read with the arming mode while the siren is going off", async () => {
    const { hap, current, target } = await mount({ alarmState: "ON", alarmMode: "ON" });
    const { SecuritySystemCurrentState, SecuritySystemTargetState } = hap.Characteristic;

    expect(await current.handleGet()).toBe(SecuritySystemCurrentState.ALARM_TRIGGERED);
    // SecuritySystemTargetState stops at DISARM (3); answering with
    // ALARM_TRIGGERED (4) made HAP reject the value outright.
    expect(await target.handleGet()).toBe(SecuritySystemTargetState.AWAY_ARM);
  });

  it("pushes the target when the panel is armed from its own keypad", async () => {
    const { hap, handler, current, target } = await mount();
    const { SecuritySystemCurrentState, SecuritySystemTargetState } = hap.Characteristic;

    await handler.update([{ name: "alarmMode", value: "ON" }], "data");

    // Without the target moving too, the Home app keeps showing the panel as
    // disarmed, and asking it to arm away becomes a no-op.
    await vi.waitFor(() => {
      expect(current.value).toBe(SecuritySystemCurrentState.AWAY_ARM);
      expect(target.value).toBe(SecuritySystemTargetState.AWAY_ARM);
    });
  });

  it("pushes the target back when a disarm event arrives", async () => {
    const { hap, handler, current, target } = await mount({ alarmMode: "ON" });
    const { SecuritySystemCurrentState, SecuritySystemTargetState } = hap.Characteristic;

    await handler.update([{ name: "eventAlarm", values: { event: { name: "arret" } } }], "cdata");

    await vi.waitFor(() => {
      expect(current.value).toBe(SecuritySystemCurrentState.DISARMED);
      expect(target.value).toBe(SecuritySystemTargetState.DISARM);
    });
  });

  /**
   * Arming Home or Night sends a zone command built from the `aliases`
   * settings. With nothing configured there was no command and no message, so
   * the Home app sat on "Arming…" for its timeout and then fell back to
   * disarmed — see https://github.com/mgcrea/homebridge-tydom/issues/167.
   */
  describe("arming a mode with no zones configured", () => {
    it("says so rather than silently doing nothing", async () => {
      const { hap, target, commands, messages } = await mount();

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.STAY_ARM);

      expect(commands).toEqual([]);
      expect(messages.filter((message) => message.startsWith("warn:")).join("\n")).toContain(
        "stay",
      );
    });

    it("treats an empty zone list as unconfigured", async () => {
      const { hap, target, commands, messages } = await mount({}, { aliases: { night: [] } });

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.NIGHT_ARM);

      expect(commands).toEqual([]);
      expect(messages.filter((message) => message.startsWith("warn:")).join("\n")).toContain(
        "night",
      );
    });

    it("stays quiet and arms when the mode does have zones", async () => {
      const { hap, target, commands, messages } = await mount({}, { aliases: { stay: [1, 2] } });

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.STAY_ARM);

      expect(commands).toEqual([
        { name: "zoneCmd", body: { value: "ON", pwd: "123456", zones: [1, 2] } },
      ]);
      expect(messages.filter((message) => message.startsWith("warn:"))).toEqual([]);
    });
  });
});
