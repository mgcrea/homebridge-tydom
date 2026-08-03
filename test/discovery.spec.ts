import { describe, expect, it } from "vitest";
import { CATEGORY } from "../src/api/device-type.js";
import {
  discoverDevices,
  expandCompanions,
  type DiscoverDevicesInput,
} from "../src/api/discovery.js";
import type {
  TydomConfigResponse,
  TydomGroupsResponse,
  TydomMetaResponse,
} from "../src/api/types.js";
import { metadataFrom } from "./helpers.js";

const SHUTTER_META = [
  "position",
  "positionCmd",
  "thermicDefect",
  "obstacleDefect",
  "intrusion",
  "battDefect",
];

const config: TydomConfigResponse = {
  endpoints: [
    {
      id_device: 1,
      id_endpoint: 1,
      name: "Volet Salon",
      first_usage: "shutter",
      last_usage: "shutter",
      picto: "p",
    },
    {
      id_device: 2,
      id_endpoint: 2,
      name: "Lampe",
      first_usage: "light",
      last_usage: "light",
      picto: "p",
    },
    {
      id_device: 3,
      id_endpoint: 3,
      name: "Mystery",
      first_usage: "somethingNew",
      last_usage: "x",
      picto: "p",
    },
  ],
  groups: [{ id: 10, name: "Salon", picto: "p", group_all: false, usage: "shutter" }],
};

const groups: TydomGroupsResponse = {
  groups: [{ id: 10, devices: [{ id: 1, endpoints: [{ id: 1 }] }] }],
};

const meta: TydomMetaResponse = [
  { id: 1, endpoints: [{ id: 1, error: 0, metadata: metadataFrom(SHUTTER_META) }] },
  { id: 2, endpoints: [{ id: 2, error: 0, metadata: metadataFrom(["level", "levelCmd"], 1) }] },
  { id: 3, endpoints: [{ id: 3, error: 0, metadata: metadataFrom(["unknown"]) }] },
];

const baseInput: DiscoverDevicesInput = { username: "012345GATEWAY", config, groups, meta };

describe("discoverDevices", () => {
  it("produces the exact accessoryId every HomeKit UUID is seeded from", () => {
    const { devices } = discoverDevices(baseInput);
    expect(devices.map((d) => d.accessoryId)).toEqual([
      "tydom:GATEWAY:accessories:1",
      "tydom:GATEWAY:accessories:2",
    ]);
  });

  it("reports unsupported endpoints instead of dropping them silently", () => {
    const { devices, skipped } = discoverDevices(baseInput);
    expect(devices).toHaveLength(2);
    expect(skipped).toEqual([
      { deviceId: 3, endpointId: 3, firstUsage: "somethingNew", reason: "unsupported" },
    ]);
  });

  it("attaches the endpoint's group", () => {
    const { devices } = discoverDevices(baseInput);
    expect(devices[0]?.group?.name).toBe("Salon");
    expect(devices[1]?.group).toBeUndefined();
  });

  it("prefers a name from settings over the gateway's", () => {
    const { devices } = discoverDevices({ ...baseInput, settings: { 2: { name: "Custom" } } });
    expect(devices[1]?.name).toBe("Custom");
  });

  it("never writes implied settings back into the caller's config object", () => {
    const userSettings = {};
    const settings = { 1: userSettings };
    const { devices } = discoverDevices({ ...baseInput, settings });
    expect(userSettings).toEqual({});
    expect(devices[0]?.settings).not.toBe(userSettings);
  });

  it("honours a numeric category override from settings", () => {
    const { devices } = discoverDevices({
      ...baseInput,
      settings: { 2: { category: CATEGORY.SWITCH } },
    });
    const light = devices.find((d) => d.deviceId === 2);
    expect(light?.category).toBe(CATEGORY.SWITCH);
    expect(light?.deviceType).toBe("switch");
  });

  it("combines a category override with the trigger setting", () => {
    const { devices } = discoverDevices({
      ...baseInput,
      settings: { 2: { category: CATEGORY.SWITCH, trigger: true } },
    });
    expect(devices.find((d) => d.deviceId === 2)?.deviceType).toBe("trigger-switch");
  });

  describe("filters", () => {
    it("applies includedDevices, matching numbers given as strings", () => {
      const { devices } = discoverDevices({ ...baseInput, filters: { includedDevices: ["1"] } });
      expect(devices.map((d) => d.deviceId)).toEqual([1]);
    });

    it("applies excludedDevices", () => {
      const { devices } = discoverDevices({ ...baseInput, filters: { excludedDevices: [1] } });
      expect(devices.map((d) => d.deviceId)).toEqual([2]);
    });

    it("applies includedCategories", () => {
      const { devices } = discoverDevices({
        ...baseInput,
        filters: { includedCategories: [CATEGORY.LIGHTBULB] },
      });
      expect(devices.map((d) => d.deviceId)).toEqual([2]);
    });

    it("applies excludedCategories", () => {
      const { devices } = discoverDevices({
        ...baseInput,
        filters: { excludedCategories: [CATEGORY.LIGHTBULB] },
      });
      expect(devices.map((d) => d.deviceId)).toEqual([1]);
    });

    it("records filtered endpoints as filtered, not unsupported", () => {
      const { skipped } = discoverDevices({ ...baseInput, filters: { excludedDevices: [1] } });
      expect(skipped.find((s) => s.deviceId === 1)?.reason).toBe("filtered");
    });
  });
});

describe("expandCompanions", () => {
  const alarm = {
    accessoryId: "tydom:GATEWAY:accessories:99",
    uniqueId: "99",
    deviceId: 99,
    endpointId: 99,
    name: "Alarme",
    deviceType: "alarm" as const,
    category: CATEGORY.SECURITY_SYSTEM,
    metadata: [],
    settings: {},
    group: undefined,
    firstUsage: "alarm",
  };

  it("adds a sensors companion with the frozen id suffix and category", () => {
    const [primary, companion] = expandCompanions(alarm);
    expect(primary).toBe(alarm);
    expect(companion?.accessoryId).toBe("tydom:GATEWAY:accessories:99:sensors");
    expect(companion?.category).toBe(110);
    expect(companion?.deviceType).toBe("alarm-sensors");
    expect(companion?.companionOf).toBe(alarm.accessoryId);
  });

  it("omits the companion when sensors are disabled", () => {
    expect(expandCompanions({ ...alarm, settings: { sensors: false } })).toEqual([
      { ...alarm, settings: { sensors: false } },
    ]);
  });

  it("leaves non-alarm devices alone", () => {
    const light = { ...alarm, deviceType: "lightbulb" as const };
    expect(expandCompanions(light)).toEqual([light]);
  });
});
