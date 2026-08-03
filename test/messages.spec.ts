import { describe, expect, it } from "vitest";
import {
  classifyMessage,
  getAccessoryId,
  getUniqueId,
  parseDeviceDataUpdate,
} from "../src/api/messages.js";

describe("classifyMessage", () => {
  it("recognises the two push endpoints", () => {
    expect(classifyMessage("/devices/data", "PUT")).toBe("data");
    expect(classifyMessage("/devices/cdata", "PUT")).toBe("cdata");
  });

  it("ignores anything that is not a PUT", () => {
    expect(classifyMessage("/devices/data", "GET")).toBe("unknown");
  });

  it("ignores unrelated URIs", () => {
    expect(classifyMessage("/ping", "PUT")).toBe("unknown");
  });

  it("tolerates the nullable uri and method the wire type allows", () => {
    expect(classifyMessage(null, "PUT")).toBe("unknown");
    expect(classifyMessage("/devices/data", null)).toBe("unknown");
    expect(classifyMessage(undefined, undefined)).toBe("unknown");
  });
});

describe("parseDeviceDataUpdate", () => {
  it("flattens one entry per endpoint", () => {
    const body = [
      {
        id: 1,
        endpoints: [
          { id: 1, data: [{ name: "level", value: 50 }] },
          { id: 2, data: [{ name: "level", value: 0 }] },
        ],
      },
    ];

    expect(parseDeviceDataUpdate(body, "data")).toEqual([
      { deviceId: 1, endpointId: 1, type: "data", updates: [{ name: "level", value: 50 }] },
      { deviceId: 1, endpointId: 2, type: "data", updates: [{ name: "level", value: 0 }] },
    ]);
  });

  it("keeps processing a device's remaining endpoints after an empty one", () => {
    // Regression: the released version used `return` inside a `for` nested in a
    // `forEach` callback, so one endpoint it could not handle silently dropped
    // every *later* endpoint of the same device.
    const body = [
      {
        id: 1,
        endpoints: [
          { id: 1 }, // no data at all
          { id: 2, data: [{ name: "level", value: 42 }] },
        ],
      },
    ];

    const result = parseDeviceDataUpdate(body, "data");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ deviceId: 1, endpointId: 2 });
  });

  it("reads cdata rather than data when asked for cdata", () => {
    const body = [{ id: 7, endpoints: [{ id: 7, data: [{ name: "a" }], cdata: [{ name: "b" }] }] }];
    expect(parseDeviceDataUpdate(body, "cdata")).toEqual([
      { deviceId: 7, endpointId: 7, type: "cdata", updates: [{ name: "b" }] },
    ]);
  });

  it("returns nothing for a non-array body", () => {
    expect(parseDeviceDataUpdate({ nope: true }, "data")).toEqual([]);
    expect(parseDeviceDataUpdate(undefined, "data")).toEqual([]);
    expect(parseDeviceDataUpdate("string", "data")).toEqual([]);
  });

  it("skips malformed devices and endpoints without throwing", () => {
    const body = [
      null,
      { id: "not-a-number", endpoints: [] },
      { id: 1 },
      { id: 2, endpoints: [null, { id: 3, data: [{ name: "ok" }] }] },
    ];
    expect(parseDeviceDataUpdate(body, "data")).toEqual([
      { deviceId: 2, endpointId: 3, type: "data", updates: [{ name: "ok" }] },
    ]);
  });
});

describe("accessory identity", () => {
  it("collapses the endpoint id when it equals the device id", () => {
    expect(getUniqueId(1521931577, 1521931577)).toBe("1521931577");
    expect(getUniqueId(1521931577, 2)).toBe("1521931577:2");
  });

  it("produces the exact accessoryId format HomeKit UUIDs are seeded from", () => {
    // Frozen: this string feeds api.hap.uuid.generate, so any change re-pairs
    // every accessory and users lose their rooms and automations.
    expect(getAccessoryId("012345MYDEVICEID", 1234, 1234)).toBe(
      "tydom:MYDEVICEID:accessories:1234",
    );
    expect(getAccessoryId("012345MYDEVICEID", 1234, 5678)).toBe(
      "tydom:MYDEVICEID:accessories:1234:5678",
    );
  });
});
