import { afterEach, describe, expect, it, vi } from "vitest";
import { SecuritySystemAccessory } from "../src/accessories/security-system-accessory.js";
import type { TydomCommand } from "../src/api/types.js";
import {
  alarmCmd,
  command,
  createAccessoryHarness,
  type HarnessOptions,
  type TydomProp,
} from "./accessory-harness.js";

/** What a 2022-or-later TYXAL+ advertises, as in every recent dump. */
const TYXAL_COMMANDS = [
  alarmCmd(["ON", "OFF", "FORCED_ON", "MAINTENANCE", "PANIC"]),
  command("zoneCmd", ["ON", "OFF", "FORCED_ON", "MAINTENANCE", "PANIC"]),
];

/** The panel in the state the arguments describe, with its services published. */
const mount = async (
  over: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
  commands: TydomCommand[] = TYXAL_COMMANDS,
  existing?: HarnessOptions["existing"],
) => {
  const data: TydomProp[] = Object.entries({
    alarmState: "OFF",
    alarmMode: "OFF",
    systAutoProtect: false,
    systOpenIssue: false,
    alarmSOS: false,
    ...over,
  }).map(([name, value]) => ({ name, value }));

  const harness = createAccessoryHarness({
    data,
    commands,
    settings: { pin: "123456", ...settings },
    ...(existing ? { existing } : {}),
  });
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

  /**
   * Firmware from about 2022 added `PANIC` to `alarmCmd`, which is the red
   * button in the official app: the siren sounds with nothing armed and no
   * detector tripped. Older panels, and every CTX60, do not offer it — hence
   * the probe rather than a flag. See
   * https://github.com/mgcrea/homebridge-tydom/issues/139.
   */
  describe("panic switch", () => {
    const sosSubtype = "panic";

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sounds the siren and springs back off", async () => {
      vi.useFakeTimers();
      const { hap, accessory, commands } = await mount({}, { panicSwitch: true });
      const service = accessory.getServiceById(hap.Service.Switch, sosSubtype);
      const { On } = hap.Characteristic;
      expect(service).toBeDefined();

      await service?.getCharacteristic(On).handleSet(true);

      expect(commands).toEqual([{ name: "alarmCmd", body: { value: "PANIC", pwd: "123456" } }]);
      // HAP stores the written value once the handler returns, so the reset
      // has to come after it. A latched switch would leave the Home app
      // claiming the siren is still sounding long after the panel has stopped.
      expect(service?.currentValue(On)).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(service?.currentValue(On)).toBe(false);
    });

    it("sends nothing when switched off", async () => {
      const { hap, accessory, commands } = await mount({}, { panicSwitch: true });
      const service = accessory.getServiceById(hap.Service.Switch, sosSubtype);

      await service?.getCharacteristic(hap.Characteristic.On).handleSet(false);

      expect(commands).toEqual([]);
    });

    it("is not published unless asked for", async () => {
      const { hap, accessory } = await mount();
      expect(accessory.getServiceById(hap.Service.Switch, sosSubtype)).toBeUndefined();
    });

    it("is not published on a panel that does not advertise PANIC", async () => {
      const { hap, accessory, messages } = await mount({}, { panicSwitch: true }, [
        alarmCmd(["ON", "OFF", "FORCED_ON"]),
      ]);
      expect(accessory.getServiceById(hap.Service.Switch, sosSubtype)).toBeUndefined();
      expect(messages.join("\n")).toMatch(/does not accept/i);
    });

    it("is not published when the gateway gave no command metadata", async () => {
      const { hap, accessory } = await mount({}, { panicSwitch: true }, []);
      expect(accessory.getServiceById(hap.Service.Switch, sosSubtype)).toBeUndefined();
    });

    it("is published when alarmCmd puts no constraint on its value", async () => {
      // Offered with no enum is not the same answer as not offered.
      const { hap, accessory } = await mount({}, { panicSwitch: true }, [command("alarmCmd")]);
      expect(accessory.getServiceById(hap.Service.Switch, sosSubtype)).toBeDefined();
    });

    it("springs back off without a pin, having sent nothing", async () => {
      vi.useFakeTimers();
      const { hap, accessory, commands } = await mount({}, { panicSwitch: true, pin: undefined });
      const service = accessory.getServiceById(hap.Service.Switch, sosSubtype);
      const { On } = hap.Characteristic;

      await service?.getCharacteristic(On).handleSet(true);
      await vi.advanceTimersByTimeAsync(1000);

      expect(commands).toEqual([]);
      expect(service?.currentValue(On)).toBe(false);
    });

    it("is removed from a cached accessory once no longer asked for", async () => {
      // A switch left behind has no handler: it toggles in the Home app and
      // sounds nothing, which is worse than no switch at all.
      const first = await mount({}, { panicSwitch: true });
      expect(first.accessory.getServiceById(first.hap.Service.Switch, sosSubtype)).toBeDefined();

      const { hap, accessory } = await mount({}, {}, TYXAL_COMMANDS, {
        accessory: first.accessory,
        hap: first.hap,
      });

      // The rebuilt handler finds the panel service already there, so mount
      // returns before setup has run.
      await vi.waitFor(() =>
        expect(accessory.getServiceById(hap.Service.Switch, sosSubtype)).toBeUndefined(),
      );
    });

    it("is removed from a cached accessory once the panel stops advertising PANIC", async () => {
      const first = await mount({}, { panicSwitch: true });

      const { hap, accessory } = await mount({}, { panicSwitch: true }, [], {
        accessory: first.accessory,
        hap: first.hap,
      });

      // The rebuilt handler finds the panel service already there, so mount
      // returns before setup has run.
      await vi.waitFor(() =>
        expect(accessory.getServiceById(hap.Service.Switch, sosSubtype)).toBeUndefined(),
      );
    });
  });

  /**
   * `FORCED_ON` is advertised by every panel in every dump, old and new, and
   * arms despite an open door or window — the case that otherwise refuses to
   * arm at all.
   */
  describe("forced arming", () => {
    it("arms away with FORCED_ON when asked", async () => {
      const { hap, target, commands } = await mount({}, { forceArm: true });

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.AWAY_ARM);

      expect(commands).toEqual([{ name: "alarmCmd", body: { value: "FORCED_ON", pwd: "123456" } }]);
    });

    it("arms zones with FORCED_ON too", async () => {
      const { hap, target, commands } = await mount(
        {},
        { forceArm: true, aliases: { stay: [1, 2] } },
      );

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.STAY_ARM);

      expect(commands).toEqual([
        { name: "zoneCmd", body: { value: "FORCED_ON", pwd: "123456", zones: [1, 2] } },
      ]);
    });

    it("still disarms with OFF", async () => {
      const { hap, target, commands } = await mount({ alarmMode: "ON" }, { forceArm: true });

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.DISARM);

      expect(commands).toEqual([{ name: "alarmCmd", body: { value: "OFF", pwd: "123456" } }]);
    });

    it("arms normally when the panel does not advertise FORCED_ON", async () => {
      const { hap, target, commands, messages } = await mount({}, { forceArm: true }, [
        alarmCmd(["ON", "OFF"]),
      ]);

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.AWAY_ARM);

      expect(commands).toEqual([{ name: "alarmCmd", body: { value: "ON", pwd: "123456" } }]);
      expect(messages.join("\n")).toMatch(/does not accept/i);
    });

    it("arms zones with ON when zoneCmd does not advertise FORCED_ON", async () => {
      // Checked against the command actually sent: alarmCmd accepting it says
      // nothing about zoneCmd.
      const { hap, target, commands } = await mount(
        {},
        { forceArm: true, aliases: { stay: [1, 2] } },
        [alarmCmd(["ON", "OFF", "FORCED_ON"]), command("zoneCmd", ["ON", "OFF"])],
      );

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.STAY_ARM);

      expect(commands).toEqual([
        { name: "zoneCmd", body: { value: "ON", pwd: "123456", zones: [1, 2] } },
      ]);
    });

    it("arms a single zone switch with FORCED_ON", async () => {
      const { hap, accessory, commands } = await mount({ zone1State: "OFF" }, { forceArm: true });
      const zone = accessory.getServiceById(hap.Service.Switch, "zone_1");

      await zone?.getCharacteristic(hap.Characteristic.On).handleSet(true);

      expect(commands).toEqual([
        { name: "zoneCmd", body: { value: "FORCED_ON", pwd: "123456", zones: [1] } },
      ]);
    });

    it("still disarms a single zone switch with OFF", async () => {
      const { hap, accessory, commands } = await mount({ zone1State: "ON" }, { forceArm: true });
      const zone = accessory.getServiceById(hap.Service.Switch, "zone_1");

      await zone?.getCharacteristic(hap.Characteristic.On).handleSet(false);

      expect(commands).toEqual([
        { name: "zoneCmd", body: { value: "OFF", pwd: "123456", zones: [1] } },
      ]);
    });

    it("arms a CTX60 with FORCED_ON, which only has partCmd", async () => {
      // A CTX60 offers no alarmCmd at all; probing that alone ignored forceArm
      // on every one of them.
      const { hap, target, commands } = await mount({}, { forceArm: true, legacy: true }, [
        command("partCmd", ["OFF", "ON", "FORCED_ON"]),
      ]);

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.AWAY_ARM);

      expect(commands.map(({ body }) => (body as { value: string }).value)).toEqual([
        "FORCED_ON",
        "FORCED_ON",
        "FORCED_ON",
        "FORCED_ON",
      ]);
    });

    it("warns once, not on every arm, when FORCED_ON is not advertised", async () => {
      const { hap, target, messages } = await mount({}, { forceArm: true }, [
        alarmCmd(["ON", "OFF"]),
      ]);
      const { AWAY_ARM } = hap.Characteristic.SecuritySystemTargetState;

      await target.handleSet(AWAY_ARM);
      await target.handleSet(AWAY_ARM);
      await target.handleSet(AWAY_ARM);

      expect(messages.filter((message) => /does not accept FORCED_ON/.test(message))).toHaveLength(
        1,
      );
    });

    it("arms with ON when not asked", async () => {
      const { hap, target, commands } = await mount();

      await target.handleSet(hap.Characteristic.SecuritySystemTargetState.AWAY_ARM);

      expect(commands).toEqual([{ name: "alarmCmd", body: { value: "ON", pwd: "123456" } }]);
    });
  });
});
