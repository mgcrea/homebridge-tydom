import { describe, expect, it } from "vitest";
import {
  CATEGORY,
  deviceTypeForCategory,
  getEndpointSignatureFromMetadata,
  resolveDeviceType,
} from "../src/api/device-type.js";
import fixtures from "./fixtures/endpoint-signatures.json" with { type: "json" };
import { metadataFrom } from "./helpers.js";

type Fixture = {
  source: string;
  firstUsage: string;
  metadataNames: string[];
  levelStep?: number;
  signature: string;
  signatureHash: string;
  expected: {
    deviceType: string;
    category: number;
    impliedSettings: Record<string, unknown>;
  } | null;
};

const endpoints = fixtures as Fixture[];

const resolve = (endpoint: Fixture) =>
  resolveDeviceType({
    firstUsage: endpoint.firstUsage,
    metadata: metadataFrom(endpoint.metadataNames, endpoint.levelStep),
    settings: {},
  });

/**
 * These fixtures are derived from nine real user device dumps, and their
 * expectations were captured from the released implementation. They are the
 * guard that this refactor did not silently re-categorise anyone's hardware:
 * a changed category makes Homebridge re-register the accessory, and the user
 * loses its room assignment and every automation referencing it.
 */
describe("resolveDeviceType against real device dumps", () => {
  it("covers a broad spread of real hardware", () => {
    // Rows are deduplicated by signature, so the nine dumps collapse to fewer
    // distinct sources wherever two users own the same device.
    expect(endpoints.length).toBeGreaterThan(20);
    expect(new Set(endpoints.map((e) => e.source)).size).toBeGreaterThanOrEqual(6);
    expect(endpoints.filter((e) => e.expected !== null).length).toBeGreaterThan(15);
  });

  const supported = endpoints.filter((e) => e.expected !== null);
  const unsupported = endpoints.filter((e) => e.expected === null);

  for (const endpoint of supported) {
    it(`resolves ${endpoint.source}/${endpoint.firstUsage} exactly as the released version did`, () => {
      const resolution = resolve(endpoint);
      expect(resolution).toBeDefined();
      expect(resolution?.category).toBe(endpoint.expected?.category);
      expect(resolution?.deviceType).toBe(endpoint.expected?.deviceType);
      expect(resolution?.impliedSettings).toEqual(endpoint.expected?.impliedSettings);
      // The hash is what the lookup table is keyed on; drift here would
      // silently unbind every user's device from its category.
      expect(resolution?.signatureHash).toBe(endpoint.signatureHash);
    });
  }

  for (const endpoint of unsupported) {
    it(`still reports ${endpoint.source}/${endpoint.firstUsage} as unsupported`, () => {
      expect(resolve(endpoint)).toBeUndefined();
    });
  }

  it("computes the signature the table is keyed on", () => {
    for (const endpoint of endpoints) {
      const metadata = metadataFrom(endpoint.metadataNames, endpoint.levelStep);
      expect(getEndpointSignatureFromMetadata(metadata)).toBe(endpoint.signature);
    }
  });
});

describe("getEndpointSignatureFromMetadata", () => {
  it("sorts names so the gateway's ordering cannot change the hash", () => {
    const a = getEndpointSignatureFromMetadata(metadataFrom(["level", "levelCmd", "recFav"]));
    const b = getEndpointSignatureFromMetadata(metadataFrom(["recFav", "level", "levelCmd"]));
    expect(a).toBe(b);
    expect(a).toBe("level|levelCmd|recFav");
  });

  it("does not mutate the metadata it is given", () => {
    const metadata = metadataFrom(["recFav", "level"]);
    getEndpointSignatureFromMetadata(metadata);
    expect(metadata.map((m) => m.name)).toEqual(["recFav", "level"]);
  });
});

describe("resolveDeviceType", () => {
  const alarmLegacy = "alarm:6e33f7ee5e62b58f4e888c91a13fd9b9d868f3751cead5ea1252578ba86523a5";

  it("returns implied settings instead of writing them into the caller's object", () => {
    // The released version did `Object.assign(settings, overrides)` on the
    // user's live platform config, so `legacy: true` persisted across re-scans.
    const settings = {};
    const resolution = resolveDeviceType({
      firstUsage: "alarm",
      metadata: metadataFrom(legacyAlarmNames()),
      settings,
    });
    expect(resolution?.signatureHash).toBe(alarmLegacy);
    expect(resolution?.impliedSettings).toEqual({ legacy: true });
    expect(settings).toEqual({});
  });

  it("falls back to first_usage when the signature is unknown", () => {
    const resolution = resolveDeviceType({
      firstUsage: "shutter",
      metadata: metadataFrom(["totallyUnknownProperty"]),
      settings: {},
    });
    expect(resolution?.deviceType).toBe("window-covering");
    expect(resolution?.category).toBe(CATEGORY.WINDOW_COVERING);
  });

  it("returns undefined for hardware it does not recognise at all", () => {
    expect(
      resolveDeviceType({
        firstUsage: "someBrandNewUsage",
        metadata: metadataFrom(["whatever"]),
        settings: {},
      }),
    ).toBeUndefined();
  });

  it("keeps belmDoor on DOOR and window on WINDOW despite one shared handler", () => {
    const names = mdoNames();
    const door = resolveDeviceType({
      firstUsage: "belmDoor",
      metadata: metadataFrom(names),
      settings: {},
    });
    const window = resolveDeviceType({
      firstUsage: "window",
      metadata: metadataFrom(names),
      settings: {},
    });
    expect(door?.deviceType).toBe("contact-sensor");
    expect(window?.deviceType).toBe("contact-sensor");
    expect(door?.category).toBe(CATEGORY.DOOR);
    expect(window?.category).toBe(CATEGORY.WINDOW);
  });

  it("splits dimmable from switchable lights on level.step", () => {
    const names = [
      "levelCmd",
      "thermicDefect",
      "level",
      "recFav",
      "onFavPos",
      "localisation",
      "modeAsso",
    ];
    const switchable = resolveDeviceType({
      firstUsage: "light",
      metadata: metadataFrom(names, 100),
      settings: {},
    });
    const dimmable = resolveDeviceType({
      firstUsage: "light",
      metadata: metadataFrom(names, 1),
      settings: {},
    });
    expect(switchable?.deviceType).toBe("lightbulb-switchable");
    expect(dimmable?.deviceType).toBe("lightbulb");
    // Same HAP category either way — only the handler differs.
    expect(switchable?.category).toBe(CATEGORY.LIGHTBULB);
    expect(dimmable?.category).toBe(CATEGORY.LIGHTBULB);
  });
});

describe("deviceTypeForCategory", () => {
  it("maps every category the old dispatch handled", () => {
    expect(deviceTypeForCategory(CATEGORY.LIGHTBULB)).toBe("lightbulb");
    expect(deviceTypeForCategory(CATEGORY.OUTLET)).toBe("outlet");
    expect(deviceTypeForCategory(CATEGORY.THERMOSTAT)).toBe("thermostat");
    expect(deviceTypeForCategory(CATEGORY.FAN)).toBe("fan");
    expect(deviceTypeForCategory(CATEGORY.GARAGE_DOOR_OPENER)).toBe("garage-door");
    expect(deviceTypeForCategory(CATEGORY.SWITCH)).toBe("switch");
    expect(deviceTypeForCategory(CATEGORY.WINDOW_COVERING)).toBe("window-covering");
    expect(deviceTypeForCategory(CATEGORY.SECURITY_SYSTEM)).toBe("alarm");
    expect(deviceTypeForCategory(CATEGORY.SENSOR)).toBe("temperature-sensor");
    expect(deviceTypeForCategory(CATEGORY.WINDOW)).toBe("contact-sensor");
    expect(deviceTypeForCategory(CATEGORY.DOOR)).toBe("contact-sensor");
    expect(deviceTypeForCategory(CATEGORY.ALARM_SENSORS)).toBe("alarm-sensors");
  });

  it("applies the settings-driven narrowings the old switch had", () => {
    expect(deviceTypeForCategory(CATEGORY.SWITCH, { trigger: true })).toBe("trigger-switch");
    expect(deviceTypeForCategory(CATEGORY.SENSOR, { smokeDetector: true })).toBe("smoke-detector");
  });

  it("returns undefined for a category the plugin has no handler for", () => {
    expect(deviceTypeForCategory(1)).toBeUndefined();
  });

  it("keeps the synthetic alarm-sensors category at 110", () => {
    // Persisted in cached accessories; changing it re-registers the companion.
    expect(CATEGORY.ALARM_SENSORS).toBe(110);
  });
});

/** Metadata names for the CTX60 legacy alarm signature. */
const legacyAlarmNames = (): string[] => {
  const fixture = endpoints.find(
    (e) =>
      e.signatureHash === "alarm:6e33f7ee5e62b58f4e888c91a13fd9b9d868f3751cead5ea1252578ba86523a5",
  );
  if (!fixture) throw new Error("legacy alarm fixture missing");
  return fixture.metadataNames;
};

/** Metadata names for the MDO door/window contact signature. */
const mdoNames = (): string[] => {
  const fixture = endpoints.find((e) =>
    e.signatureHash.endsWith("fb935867933d89b3058f09384f76fd63f3defb18cfb3172f60fa9f4f237f748b"),
  );
  if (!fixture) throw new Error("MDO fixture missing");
  return fixture.metadataNames;
};
