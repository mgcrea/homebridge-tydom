import { describe, expect, it } from "vitest";
import {
  ALARM_STATE,
  getActiveZones,
  getStateForActiveZones,
  getStateForAlarmData,
  isZoneArmed,
} from "../src/accessories/security-system-state.js";
import type { TydomEndpointData } from "../src/api/types.js";

const data = (entries: Record<string, unknown>): TydomEndpointData =>
  Object.entries(entries).map(([name, value]) => ({
    name,
    value: value as string,
    validity: "upToDate" as const,
  }));

/**
 * These were previously unreachable from a test: they closed over HAP's
 * `Characteristic` inside the accessory module. They decide whether HomeKit
 * shows the alarm as armed, and getting them wrong is the difference between a
 * user thinking their house is protected and it not being.
 */
describe("getActiveZones", () => {
  it("reads zoneNState on a modern panel", () => {
    expect(
      getActiveZones(
        data({ zone1State: "ON", zone2State: "OFF", zone3State: "ON", zone4State: "UNUSED" }),
        {},
      ),
    ).toEqual([1, 3]);
  });

  it("reads partNState on a legacy panel", () => {
    expect(getActiveZones(data({ part1State: "ON", part2State: "ON" }), { legacy: true })).toEqual([
      1, 2,
    ]);
  });

  it("does not read parts on a modern panel, or zones on a legacy one", () => {
    expect(getActiveZones(data({ part1State: "ON" }), {})).toEqual([]);
    expect(getActiveZones(data({ zone1State: "ON" }), { legacy: true })).toEqual([]);
  });

  it("ignores unrelated properties", () => {
    expect(getActiveZones(data({ alarmMode: "ZONE", zone1State: "ON" }), {})).toEqual([1]);
  });

  it("returns nothing when no zone is armed", () => {
    expect(getActiveZones(data({ zone1State: "OFF", zone2State: "UNUSED" }), {})).toEqual([]);
  });
});

describe("getStateForActiveZones", () => {
  it("matches the user's stay alias", () => {
    expect(getStateForActiveZones([1, 2], { stay: [1, 2] })).toBe(ALARM_STATE.STAY_ARM);
  });

  it("matches the user's night alias", () => {
    expect(getStateForActiveZones([3], { night: [3] })).toBe(ALARM_STATE.NIGHT_ARM);
  });

  it("ignores ordering when matching an alias", () => {
    expect(getStateForActiveZones([2, 1], { stay: [1, 2] })).toBe(ALARM_STATE.STAY_ARM);
  });

  it("reports disarmed for a partial arm that matches no alias", () => {
    // Deliberate: claiming AWAY_ARM for an unrecognised combination would tell
    // the user the house is fully armed when it is not.
    expect(getStateForActiveZones([1, 5], { stay: [1, 2], night: [3] })).toBe(ALARM_STATE.DISARMED);
  });

  it("reports disarmed when no aliases are configured", () => {
    expect(getStateForActiveZones([1, 2], {})).toBe(ALARM_STATE.DISARMED);
  });
});

describe("isZoneArmed", () => {
  it("reports no zone armed when the panel is off, whatever the zone says", () => {
    // The reported bug: disarming from the main selector left the zone
    // switches showing armed. The panel does not always volunteer a fresh
    // `zoneNState` when it disarms, so the stale one has to be overruled.
    const payload = data({ alarmMode: "OFF", zone1State: "ON", zone2State: "ON" });
    expect(isZoneArmed(payload, "zone1State")).toBe(false);
    expect(isZoneArmed(payload, "zone2State")).toBe(false);
  });

  it("reports every zone armed when the panel is fully armed", () => {
    // A full away-arm carries no per-zone state at all.
    const payload = data({ alarmMode: "ON" });
    expect(isZoneArmed(payload, "zone1State")).toBe(true);
    expect(isZoneArmed(payload, "zone4State")).toBe(true);
  });

  it("defers to the zone property for a partial arm", () => {
    const payload = data({ alarmMode: "ZONE", zone1State: "ON", zone2State: "OFF" });
    expect(isZoneArmed(payload, "zone1State")).toBe(true);
    expect(isZoneArmed(payload, "zone2State")).toBe(false);
  });

  it("reports a zone it knows nothing about as disarmed", () => {
    expect(isZoneArmed(data({ alarmMode: "ZONE" }), "zone7State")).toBe(false);
  });

  it("works for legacy part properties too", () => {
    expect(isZoneArmed(data({ alarmMode: "OFF", part2State: "ON" }), "part2State")).toBe(false);
    expect(isZoneArmed(data({ alarmMode: "PART", part2State: "ON" }), "part2State")).toBe(true);
  });
});

describe("getStateForAlarmData", () => {
  it.each(["DELAYED", "ON", "QUIET"])(
    "reports a triggered alarm for alarmState=%s, whatever the mode",
    (alarmState) => {
      expect(getStateForAlarmData(data({ alarmState, alarmMode: "OFF" }), {}, {})).toBe(
        ALARM_STATE.ALARM_TRIGGERED,
      );
    },
  );

  it("reports away-arm for a fully armed panel", () => {
    expect(getStateForAlarmData(data({ alarmState: "OFF", alarmMode: "ON" }), {}, {})).toBe(
      ALARM_STATE.AWAY_ARM,
    );
  });

  it("resolves a zone arm through the aliases", () => {
    const payload = data({
      alarmState: "OFF",
      alarmMode: "ZONE",
      zone1State: "ON",
      zone2State: "OFF",
    });
    expect(getStateForAlarmData(payload, { stay: [1] }, {})).toBe(ALARM_STATE.STAY_ARM);
  });

  it("resolves a legacy part arm", () => {
    const payload = data({ alarmState: "OFF", alarmMode: "PART", part2State: "ON" });
    expect(getStateForAlarmData(payload, { night: [2] }, { legacy: true })).toBe(
      ALARM_STATE.NIGHT_ARM,
    );
  });

  it("reports disarmed when the panel is off", () => {
    expect(getStateForAlarmData(data({ alarmState: "OFF", alarmMode: "OFF" }), {}, {})).toBe(
      ALARM_STATE.DISARMED,
    );
  });

  it("reports disarmed rather than throwing on a partial payload", () => {
    expect(getStateForAlarmData(data({}), {}, {})).toBe(ALARM_STATE.DISARMED);
  });
});
