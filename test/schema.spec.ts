import { readFileSync } from "node:fs";
import type { PlatformConfig } from "homebridge";
import { describe, expect, it } from "vitest";
import { PLATFORM_NAME } from "../src/config/env.js";
import {
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_PRIMARY_RETRY_INTERVAL_MS,
  DEFAULT_STALE_AFTER_MS,
  MIN_PRIMARY_RETRY_INTERVAL_MS,
  MIN_REFRESH_INTERVAL_MS,
  parseConfig,
} from "../src/config.js";

/**
 * The schema is what the Homebridge UI renders, and it drifted badly: six
 * supported options were missing from it, so the only way to reach them was to
 * hand-edit config.json. These tests tie it back to `parseConfig`, which is the
 * actual definition of what the plugin accepts.
 */
const schema = JSON.parse(
  readFileSync(new URL("../config.schema.json", import.meta.url), "utf8"),
) as {
  pluginAlias: string;
  pluginType: string;
  schema: {
    properties: Record<string, { default?: unknown; minimum?: number; required?: boolean }>;
  };
  layout: { items: unknown[] }[];
};

const PROPERTIES = Object.keys(schema.schema.properties);

describe("config.schema.json", () => {
  it("declares the alias every installed user already has in their config.json", () => {
    // Changing this orphans the platform block in every existing install.
    expect(schema.pluginAlias).toBe(PLATFORM_NAME);
    expect(schema.pluginType).toBe("platform");
  });

  it("offers every option parseConfig reads", () => {
    expect(PROPERTIES.toSorted()).toEqual([
      "debug",
      "email",
      "excludedCategories",
      "excludedDevices",
      "hostname",
      "includedCategories",
      "includedDevices",
      "localHostname",
      "locale",
      "password",
      "pin",
      "primaryRetryInterval",
      "refreshInterval",
      "settings",
      "staleAfter",
      "username",
      "webhooks",
    ]);
  });

  it("puts every declared option somewhere in the layout", () => {
    // A property absent from the layout is invisible in the UI, which is how
    // the six missing options went unnoticed for so long.
    const laidOut = new Set<string>();
    const walk = (node: unknown): void => {
      if (typeof node === "string") {
        laidOut.add(node.replace(/[[.].*$/, ""));
      } else if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === "object") {
        const { key, items } = node as { key?: string; items?: unknown };
        if (key) laidOut.add(key.replace(/[[.].*$/, ""));
        if (items) walk(items);
      }
    };
    walk(schema.layout);
    expect(PROPERTIES.filter((name) => !laidOut.has(name))).toEqual([]);
  });

  it("masks every secret", () => {
    for (const name of ["password", "pin"] as const) {
      expect(schema.schema.properties[name]).toMatchObject({
        "x-schema-form": { type: "password" },
      });
    }
  });

  it("agrees with parseConfig on defaults", () => {
    const props = schema.schema.properties;
    expect(props["refreshInterval"]?.default).toBe(DEFAULT_REFRESH_INTERVAL_MS / 1000);
    expect(props["refreshInterval"]?.minimum).toBe(MIN_REFRESH_INTERVAL_MS / 1000);
    expect(props["primaryRetryInterval"]?.default).toBe(DEFAULT_PRIMARY_RETRY_INTERVAL_MS / 1000);
    expect(props["primaryRetryInterval"]?.minimum).toBe(MIN_PRIMARY_RETRY_INTERVAL_MS / 1000);
    expect(props["staleAfter"]?.default).toBe(DEFAULT_STALE_AFTER_MS / 1000);

    const parsed = parseConfig(
      { platform: PLATFORM_NAME, hostname: "h", username: "u", password: "p" },
      {},
    );
    expect(parsed.locale).toBe(props["locale"]?.default);
    expect(parsed.debug).toBe(props["debug"]?.default);
  });

  it("marks exactly the fields parseConfig refuses to run without as required", () => {
    const required = PROPERTIES.filter((name) => schema.schema.properties[name]?.required);
    expect(required.toSorted()).toEqual(["hostname", "password", "username"]);
    for (const omitted of required) {
      const config: PlatformConfig = {
        platform: PLATFORM_NAME,
        hostname: "h",
        username: "u",
        password: "p",
      };
      delete config[omitted];
      // The message names the missing field: it is the only thing the user
      // sees, since the platform reports it and then stays dormant.
      expect(() => parseConfig(config, {})).toThrow(new RegExp(`Missing "${omitted}"`));
    }
  });

  it("leaves the account e-mail optional, since omitting it is the default setup", () => {
    expect(schema.schema.properties["email"]?.required).toBeUndefined();
    expect(() =>
      parseConfig({ platform: PLATFORM_NAME, hostname: "h", username: "u", password: "p" }, {}),
    ).not.toThrow();
  });
});
