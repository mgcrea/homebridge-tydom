import type { PlatformConfig } from "homebridge";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_PRIMARY_RETRY_INTERVAL_MS,
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_STALE_AFTER_MS,
  MIN_PRIMARY_RETRY_INTERVAL_MS,
  MIN_REFRESH_INTERVAL_MS,
  parseConfig,
} from "../src/config.js";

const base = {
  platform: "Tydom",
  hostname: "mediation.tydom.com",
  username: "001A25123456",
  password: "s3cret",
} as unknown as PlatformConfig;

/** base64, the encoding the env escape hatches expect. */
const b64 = (value: string): string => Buffer.from(value, "utf8").toString("base64");

describe("parseConfig", () => {
  it("parses a minimal config", () => {
    const config = parseConfig(base, {});
    expect(config.hostname).toBe("mediation.tydom.com");
    expect(config.localHostname).toBeUndefined();
    expect(config.username).toBe("001A25123456");
    expect(config.password).toBe("s3cret");
    expect(config.debug).toBe(false);
    expect(config.locale).toBe("fr");
    expect(config.refreshIntervalMs).toBe(DEFAULT_REFRESH_INTERVAL_MS);
    expect(config.primaryRetryIntervalMs).toBe(DEFAULT_PRIMARY_RETRY_INTERVAL_MS);
  });

  it("trims whitespace out of the hostname and username", () => {
    const config = parseConfig({ ...base, hostname: "  host  ", username: " user " }, {});
    expect(config.hostname).toBe("host");
    expect(config.username).toBe("user");
  });

  describe("required fields", () => {
    it.each([
      ["hostname", 'Missing "hostname"'],
      ["username", 'Missing "username"'],
      ["password", 'Missing "password"'],
    ])("rejects a missing %s with an actionable message", (field, expected) => {
      const config = { ...base, [field]: "" } as unknown as PlatformConfig;
      expect(() => parseConfig(config, {})).toThrow(ConfigError);
      expect(() => parseConfig(config, {})).toThrow(expected);
    });

    it("throws ConfigError, not a bare assertion", () => {
      // The released code asserted inside the controller constructor, so a
      // fat-fingered config surfaced as an unhandled AssertionError and took
      // the whole bridge down. The platform can only stay dormant instead if
      // the failure is a type it recognises.
      const thrown = (() => {
        try {
          parseConfig({ ...base, password: "" } as unknown as PlatformConfig, {});
          return undefined;
        } catch (err) {
          return err;
        }
      })();
      expect(thrown).toBeInstanceOf(ConfigError);
      expect((thrown as Error).name).toBe("ConfigError");
    });
  });

  describe("Delta Dore account e-mail", () => {
    it("leaves the e-mail undefined by default, which is what every existing install has", () => {
      const config = parseConfig(base, {});
      expect(config.email).toBeUndefined();
      expect(config.password).toBe("s3cret");
    });

    it("carries the e-mail through, so the controller knows which kind of password it holds", () => {
      const config = parseConfig({ ...base, email: "someone@example.test" } as never, {});
      expect(config.email).toBe("someone@example.test");
      expect(config.password).toBe("s3cret");
    });

    it("reads the e-mail from the environment", () => {
      const config = parseConfig(base, { HOMEBRIDGE_TYDOM_EMAIL: "env@example.test" });
      expect(config.email).toBe("env@example.test");
    });

    it("prefers the environment over the config file", () => {
      const config = parseConfig({ ...base, email: "file@example.test" } as never, {
        HOMEBRIDGE_TYDOM_EMAIL: "env@example.test",
      });
      expect(config.email).toBe("env@example.test");
    });

    it("still requires a password, and says which one it wants", () => {
      // The two cases want different secrets, so one message cannot serve both.
      const withEmail = { ...base, password: "", email: "a@b.test" } as unknown as PlatformConfig;
      expect(() => parseConfig(withEmail, {})).toThrow(ConfigError);
      expect(() => parseConfig(withEmail, {})).toThrow("Delta Dore account a@b.test");

      const withoutEmail = { ...base, password: "" } as unknown as PlatformConfig;
      expect(() => parseConfig(withoutEmail, {})).toThrow("gateway's password");
      expect(() => parseConfig(withoutEmail, {})).toThrow('set "email"');
    });
  });

  describe("environment escape hatches", () => {
    it("prefers a base64 password from the environment", () => {
      const config = parseConfig(base, { HOMEBRIDGE_TYDOM_PASSWORD: b64("from-env") });
      expect(config.password).toBe("from-env");
    });

    it("accepts a password only from the environment", () => {
      const config = parseConfig({ ...base, password: "" } as unknown as PlatformConfig, {
        HOMEBRIDGE_TYDOM_PASSWORD: b64("from-env"),
      });
      expect(config.password).toBe("from-env");
    });

    it("decodes a password containing non-ASCII characters", () => {
      // Decoding as "ascii" masks the high bit of every byte, so an account
      // password with an accent in it silently became mojibake and the sign-in
      // failed with nothing but an opaque `invalid_grant` to go on.
      const password = "Mot2Passe-éàü£";
      const config = parseConfig(base, { HOMEBRIDGE_TYDOM_PASSWORD: b64(password) });
      expect(config.password).toBe(password);
    });

    it("reads the alarm pin from the environment", () => {
      expect(parseConfig(base, { HOMEBRIDGE_TYDOM_PIN: b64("123456") }).pin).toBe("123456");
    });

    it("leaves the pin undefined when nothing supplies one", () => {
      expect(parseConfig(base, {}).pin).toBeUndefined();
    });

    it("reads the locale from the environment at parse time, not import time", () => {
      expect(parseConfig(base, { HOMEBRIDGE_TYDOM_LOCALE: "en" }).locale).toBe("en");
      expect(parseConfig(base, { HOMEBRIDGE_TYDOM_LOCALE: "de" }).locale).toBe("fr");
    });
  });

  describe("refreshInterval", () => {
    it("converts the user-facing seconds to milliseconds", () => {
      expect(parseConfig({ ...base, refreshInterval: 600 } as never, {}).refreshIntervalMs).toBe(
        600_000,
      );
    });

    it("clamps values that would hammer the gateway", () => {
      expect(parseConfig({ ...base, refreshInterval: 1 } as never, {}).refreshIntervalMs).toBe(
        MIN_REFRESH_INTERVAL_MS,
      );
    });

    it("falls back to the default when the value is not a number", () => {
      expect(parseConfig({ ...base, refreshInterval: "soon" } as never, {}).refreshIntervalMs).toBe(
        DEFAULT_REFRESH_INTERVAL_MS,
      );
    });
  });

  describe("local fallback", () => {
    it("trims and keeps a distinct local hostname", () => {
      const config = parseConfig(
        { ...base, localHostname: "  192.168.1.42  ", primaryRetryInterval: 45 } as never,
        {},
      );
      expect(config.localHostname).toBe("192.168.1.42");
      expect(config.primaryRetryIntervalMs).toBe(45_000);
    });

    it("disables a fallback that names the primary endpoint", () => {
      const config = parseConfig({ ...base, localHostname: " mediation.tydom.com " } as never, {});
      expect(config.localHostname).toBeUndefined();
    });

    it("clamps an aggressive primary retry interval", () => {
      const config = parseConfig({ ...base, primaryRetryInterval: 1 } as never, {});
      expect(config.primaryRetryIntervalMs).toBe(MIN_PRIMARY_RETRY_INTERVAL_MS);
    });

    it("uses the default for a non-numeric primary retry interval", () => {
      const config = parseConfig({ ...base, primaryRetryInterval: "soon" } as never, {});
      expect(config.primaryRetryIntervalMs).toBe(DEFAULT_PRIMARY_RETRY_INTERVAL_MS);
    });
  });

  describe("staleAfter", () => {
    it("converts the user-facing seconds to milliseconds", () => {
      expect(parseConfig({ ...base, staleAfter: 30 } as never, {}).staleAfterMs).toBe(30_000);
    });

    it("defaults to five minutes", () => {
      expect(parseConfig(base as never, {}).staleAfterMs).toBe(DEFAULT_STALE_AFTER_MS);
    });

    it("accepts zero, which reads through on every query", () => {
      // The escape hatch back to pre-0.30 behaviour, so it must not be clamped
      // or treated as "unset".
      expect(parseConfig({ ...base, staleAfter: 0 } as never, {}).staleAfterMs).toBe(0);
    });

    it("falls back to the default for a negative or non-numeric value", () => {
      expect(parseConfig({ ...base, staleAfter: -1 } as never, {}).staleAfterMs).toBe(
        DEFAULT_STALE_AFTER_MS,
      );
      expect(parseConfig({ ...base, staleAfter: "never" } as never, {}).staleAfterMs).toBe(
        DEFAULT_STALE_AFTER_MS,
      );
    });
  });

  describe("optional collections", () => {
    it("defaults every filter to an empty array", () => {
      const config = parseConfig(base, {});
      expect(config.includedDevices).toEqual([]);
      expect(config.excludedDevices).toEqual([]);
      expect(config.includedCategories).toEqual([]);
      expect(config.excludedCategories).toEqual([]);
      expect(config.webhooks).toEqual([]);
      expect(config.settings).toEqual({});
    });

    it("ignores non-array filters rather than crashing later", () => {
      const config = parseConfig({ ...base, includedDevices: "1234" } as never, {});
      expect(config.includedDevices).toEqual([]);
    });

    it("keeps the filters it is given", () => {
      const config = parseConfig({ ...base, excludedDevices: [1, "2"] } as never, {});
      expect(config.excludedDevices).toEqual([1, "2"]);
    });
  });

  describe("webhooks", () => {
    const withWebhooks = (webhooks: unknown) => parseConfig({ ...base, webhooks } as never, {});

    it("keeps a well-formed webhook", () => {
      const url = "https://discord.com/api/webhooks/1/abc";
      const config = withWebhooks([{ url, type: "discord" }]);
      expect(config.webhooks).toEqual([{ url, type: "discord" }]);
      expect(config.warnings).toEqual([]);
    });

    it("drops a URL that is not one, and keeps the platform running", () => {
      // A typo here used to disable the whole platform, which costs the user
      // their lights over a notification they would merely have missed. Before
      // that it reached `new URL()` inside the notification handler and threw
      // when the alarm fired.
      const config = withWebhooks([{ url: "discord.com/webhook", type: "discord" }]);
      expect(config.webhooks).toEqual([]);
      expect(config.warnings).toHaveLength(1);
      expect(config.warnings[0]).toMatch(/Ignoring webhook 0.*"url"/);
    });

    it("keeps the good entries alongside a bad one", () => {
      // Walking the list by hand rather than parsing it as a whole is what
      // makes this possible: one `z.array` parse would reject all of them.
      const good = { url: "https://discord.com/api/webhooks/1/abc", type: "discord" };
      const config = withWebhooks([good, { url: "nope", type: "discord" }]);
      expect(config.webhooks).toEqual([good]);
      expect(config.warnings[0]).toMatch(/Ignoring webhook 1/);
    });

    it("drops a webhook type it would have silently ignored", () => {
      const config = withWebhooks([{ url: "https://example.com/hook", type: "slack" }]);
      expect(config.webhooks).toEqual([]);
      expect(config.warnings[0]).toMatch(/only "discord"/);
    });

    it("drops a webhook missing its URL", () => {
      expect(withWebhooks([{ type: "discord" }]).webhooks).toEqual([]);
    });

    it("reports a webhooks value that is not a list", () => {
      const config = withWebhooks("https://discord.com/api/webhooks/1/abc");
      expect(config.webhooks).toEqual([]);
      expect(config.warnings[0]).toMatch(/expected a list/);
    });

    it("says nothing when none are configured", () => {
      expect(withWebhooks(undefined).warnings).toEqual([]);
    });
  });

  describe("device settings", () => {
    const withSettings = (settings: unknown) => parseConfig({ ...base, settings } as never, {});

    it("keeps free-form per-device options", () => {
      // What a device accepts depends on what it is, so the contents are not
      // constrained — only the shape.
      const settings = { "1234567": { name: "Kitchen blind", delay: 20_000, aliases: {} } };
      const config = withSettings(settings);
      expect(config.settings).toEqual(settings);
      expect(config.warnings).toEqual([]);
    });

    it("drops a key that is not a device id, keeping the rest", () => {
      const config = withSettings({
        "1234567": { name: "Kitchen blind" },
        "kitchen-blind": { name: "x" },
      });
      expect(Object.keys(config.settings)).toEqual(["1234567"]);
      expect(config.warnings[0]).toMatch(/not a numeric device id/);
    });

    it("drops a device whose settings are not an object", () => {
      const config = withSettings({ "1234567": "Kitchen blind" });
      expect(config.settings).toEqual({});
      expect(config.warnings).toHaveLength(1);
    });

    it("reports an array, which used to pass the typeof check", () => {
      // `typeof [] === "object"`, so an earlier guard let one through.
      const config = withSettings([]);
      expect(config.settings).toEqual({});
      expect(config.warnings[0]).toMatch(/keyed by device id/);
    });
  });

  describe("what is fatal and what is not", () => {
    it("still refuses to run without the connection fields", () => {
      // The line: no hostname means there is nothing to talk to, so the
      // platform reports it and stays dormant. A bad webhook does not.
      expect(() => parseConfig({ ...base, hostname: "" } as never, {})).toThrow(ConfigError);
    });

    it("never throws for a malformed optional collection", () => {
      expect(() =>
        parseConfig({ ...base, webhooks: [{ url: "nope" }], settings: 42 } as never, {}),
      ).not.toThrow();
    });
  });
});
