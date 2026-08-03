import { describe, expect, it } from "vitest";
import type { TydomEndpointData } from "../src/api/types.js";
import {
  getTydomDataPropValue,
  parseDiscoveryResponse,
  TydomSchemaError,
  tydomConfigResponseSchema,
  tydomGroupsResponseSchema,
  tydomMetaResponseSchema,
} from "../src/api/types.js";

describe("discovery schemas", () => {
  describe("/configs/file", () => {
    it("parses a well-formed response", () => {
      const parsed = parseDiscoveryResponse("/configs/file", tydomConfigResponseSchema, {
        endpoints: [
          {
            id_device: 1,
            id_endpoint: 1,
            name: "Volet",
            first_usage: "shutter",
            last_usage: "shutter",
            picto: "p",
          },
        ],
        groups: [{ id: 10, name: "Salon", picto: "p", group_all: false, usage: "shutter" }],
      });
      expect(parsed.endpoints).toHaveLength(1);
      expect(parsed.groups[0]?.name).toBe("Salon");
    });

    it("keeps fields the gateway added that we do not model", () => {
      // Firmware updates add keys; dropping them silently would be worse than
      // carrying them along untyped.
      const parsed = parseDiscoveryResponse("/configs/file", tydomConfigResponseSchema, {
        endpoints: [],
        groups: [],
        version: "1.2.3",
        id_catalog: "abc",
      });
      expect(parsed).toMatchObject({ version: "1.2.3", id_catalog: "abc" });
    });

    it("defaults missing collections rather than failing", () => {
      expect(parseDiscoveryResponse("/configs/file", tydomConfigResponseSchema, {})).toEqual({
        endpoints: [],
        groups: [],
      });
    });

    it("names the endpoint when the shape is wrong", () => {
      // Without this, a firmware change surfaces as
      // `TypeError: config.endpoints is not iterable` from inside discovery.
      const thrown = (() => {
        try {
          parseDiscoveryResponse("/configs/file", tydomConfigResponseSchema, { endpoints: "nope" });
          return undefined;
        } catch (err) {
          return err;
        }
      })();
      expect(thrown).toBeInstanceOf(TydomSchemaError);
      expect((thrown as Error).message).toContain("/configs/file");
      expect((thrown as Error).message).toContain("unexpected shape");
    });

    it("rejects a null payload", () => {
      expect(() =>
        parseDiscoveryResponse("/configs/file", tydomConfigResponseSchema, null),
      ).toThrow(TydomSchemaError);
    });
  });

  describe("/groups/file", () => {
    it("parses the nested group/device/endpoint tree", () => {
      const parsed = parseDiscoveryResponse("/groups/file", tydomGroupsResponseSchema, {
        groups: [{ id: 10, devices: [{ id: 1, endpoints: [{ id: 1 }] }] }],
      });
      expect(parsed.groups[0]?.devices[0]?.endpoints[0]?.id).toBe(1);
    });

    it("defaults an absent groups array", () => {
      expect(parseDiscoveryResponse("/groups/file", tydomGroupsResponseSchema, {})).toEqual({
        groups: [],
      });
    });
  });

  describe("/devices/meta", () => {
    it("parses a device with metadata", () => {
      const parsed = parseDiscoveryResponse("/devices/meta", tydomMetaResponseSchema, [
        {
          id: 1,
          endpoints: [
            { id: 1, error: 0, metadata: [{ name: "level", permission: "rw", type: "numeric" }] },
          ],
        },
      ]);
      expect(parsed[0]?.endpoints[0]?.metadata[0]?.name).toBe("level");
    });

    it("accepts a permission or type value it has never seen", () => {
      // These are plain strings on purpose: a firmware introducing a fourth
      // type must not make the whole device undiscoverable.
      const parsed = parseDiscoveryResponse("/devices/meta", tydomMetaResponseSchema, [
        {
          id: 1,
          endpoints: [
            { id: 1, metadata: [{ name: "novel", permission: "xr", type: "quaternion" }] },
          ],
        },
      ]);
      expect(parsed[0]?.endpoints[0]?.metadata[0]).toMatchObject({
        permission: "xr",
        type: "quaternion",
      });
    });

    it("rejects a non-array payload", () => {
      expect(() =>
        parseDiscoveryResponse("/devices/meta", tydomMetaResponseSchema, { devices: [] }),
      ).toThrow(TydomSchemaError);
    });
  });

  it("truncates a very long validation error", () => {
    const huge = { endpoints: Array.from({ length: 200 }, () => ({ id_device: "wrong" })) };
    const thrown = (() => {
      try {
        parseDiscoveryResponse("/configs/file", tydomConfigResponseSchema, huge);
        return undefined;
      } catch (err) {
        return err as Error;
      }
    })();
    expect(thrown?.message.length).toBeLessThan(400);
  });
});

const setpointData = (value: unknown): TydomEndpointData => [
  { name: "setpoint", value: value as never, validity: "upToDate" },
];

describe("getTydomDataPropValue", () => {
  it("returns the value", () => {
    expect(getTydomDataPropValue(setpointData(21.5), "setpoint")).toBe(21.5);
  });

  it("returns null rather than throwing when the gateway sends one", () => {
    // Not hypothetical: a thermostat driven by thermic levels — a towel rail —
    // reports `setpoint: null` on every read. The property is present, so this
    // must not be treated as a missing property; the caller needs the null in
    // order to substitute something HomeKit will accept.
    expect(getTydomDataPropValue(setpointData(null), "setpoint")).toBeNull();
  });

  it("throws when the property is genuinely absent", () => {
    expect(() => getTydomDataPropValue(setpointData(21.5), "nope")).toThrow('name="nope"');
  });
});
