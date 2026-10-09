import type { PlatformConfig } from "homebridge";
import { z } from "zod";
import type { DeviceSettings } from "./api/discovery.js";
import type { Webhook } from "./helpers/webhook.js";
import type { Locale } from "./i18n/index.js";
import { decode } from "./util/hash.js";

/**
 * A configuration problem the user has to fix.
 *
 * Distinguished from other failures so the platform can report it as a single
 * clear line and stay dormant, rather than throwing out of its constructor and
 * taking the whole bridge down with it — which is what the assertions this
 * replaces used to do.
 */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** The locales the label tables ship. Owned by `src/i18n`, which holds them. */
export type TydomLocale = Locale;

/** The platform's configuration, parsed once and normalised. */
export type TydomConfig = {
  hostname: string;
  /** Optional LAN endpoint used while the primary endpoint is unavailable. */
  localHostname: string | undefined;
  username: string;
  /**
   * The password — of the account when `email` is set, of the gateway when it
   * is not. `email` is the discriminator; see it for why there is only one.
   */
  password: string;
  /**
   * Delta Dore account e-mail, if the gateway password is to be derived.
   *
   * Set, and `password` above is the account password: the controller signs in
   * with the pair and fetches the gateway password from Delta Dore. Unset — the
   * default, and what every existing install has — and `password` is the
   * gateway password, used directly.
   *
   * One password field rather than two because the e-mail already says which
   * kind it is, and nobody needs to supply both: knowing the gateway password
   * is the whole point of signing in.
   */
  email: string | undefined;
  /** Alarm PIN, if configured here rather than per-device. */
  pin: string | undefined;
  locale: TydomLocale;
  debug: boolean;
  settings: Record<string, DeviceSettings>;
  webhooks: Webhook[];
  includedDevices: (string | number)[];
  excludedDevices: (string | number)[];
  includedCategories: (string | number)[];
  excludedCategories: (string | number)[];
  /** User-facing seconds become milliseconds at the boundary. */
  refreshIntervalMs: number;
  /** How often the primary endpoint is probed while the LAN fallback is active. */
  primaryRetryIntervalMs: number;
  /**
   * How long a device reading is served from memory before a read repairs it
   * in the background. `0` reads through on every HomeKit query, which is what
   * releases before 0.30 did.
   */
  staleAfterMs: number;
  /**
   * Recoverable problems found while parsing, for the platform to log.
   *
   * Carried on the config rather than thrown because these do not stop the
   * plugin working; see `parseWebhooks` for where the line sits.
   */
  warnings: string[];
};

export const DEFAULT_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
export const DEFAULT_PRIMARY_RETRY_INTERVAL_MS = 5 * 60 * 1000;
/** A refresh is a full `POST /refresh/all`; hammering the gateway helps nobody. */
export const MIN_REFRESH_INTERVAL_MS = 60 * 1000;
/** Repeated TLS handshakes are not a useful way to monitor the relay. */
export const MIN_PRIMARY_RETRY_INTERVAL_MS = 30 * 1000;

const asArray = (value: unknown): (string | number)[] =>
  Array.isArray(value) ? (value as (string | number)[]) : [];

/**
 * The two config values that are structures rather than scalars.
 *
 * These were the only casts in `parseConfig` that crossed a trust boundary:
 * `config["webhooks"] as Webhook[]` checked `Array.isArray` and nothing more,
 * so a malformed entry reached `new URL()` inside the notification handler and
 * threw there — at whatever hour the alarm happened to fire, from a `forEach`
 * with nothing to catch it. Checking at startup means the user hears about it
 * while they are still looking at the config file.
 *
 * Both are parsed rather than merely validated, so what comes out is what the
 * rest of the plugin is typed against.
 */
const webhookSchema = z.object({
  url: z.url("must be a full URL, e.g. https://discord.com/api/webhooks/…"),
  // Only Discord is implemented; anything else silently did nothing.
  type: z.literal("discord", 'is not a webhook type this plugin knows (only "discord")'),
});

/**
 * One device's overrides, keyed in the config by numeric device id.
 *
 * Deliberately permissive about the contents: which options a device accepts
 * depends on what it is, and the device-type layer already ignores what does
 * not apply. Only the shape is checked here — that it is an object at all.
 */
const deviceSettingsSchema = z.looseObject({});

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Environment escape hatches, read here rather than at module scope.
 *
 * At module scope they could not be tested, and `locale` in particular was
 * fixed at import time — before Homebridge had even read the config file.
 */
export type ConfigEnv = {
  HOMEBRIDGE_TYDOM_PASSWORD?: string | undefined;
  HOMEBRIDGE_TYDOM_PIN?: string | undefined;
  HOMEBRIDGE_TYDOM_LOCALE?: string | undefined;
  HOMEBRIDGE_TYDOM_EMAIL?: string | undefined;
  // Present so `process.env` — which carries an index signature — is assignable.
  [key: string]: string | undefined;
};

/**
 * Parse the optional collections, keeping whatever is usable.
 *
 * A malformed entry in one of these is not a reason to take the platform down.
 * The connection fields are — without a hostname there is nothing to talk to,
 * so `parseConfig` still throws for those. But a typo in a webhook URL should
 * cost the user their notifications, not their lights, and an earlier version
 * of this validation disabled the whole platform over one. The bad entry is
 * dropped, the reason is reported, and everything else keeps working.
 *
 * The entry schemas stay zod — the URL check is the part with real value. Only
 * the surrounding container is walked by hand, so one bad element cannot
 * invalidate its siblings the way a single `z.array` parse would.
 */
const describeIssue = (error: z.ZodError): string => {
  const [issue] = error.issues;
  const path = issue?.path.join(".");
  const message = issue?.message ?? "is not usable";
  return path ? `"${path}" ${message}` : message;
};

const parseWebhooks = (value: unknown, warn: (message: string) => void): Webhook[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    warn(`Ignoring "webhooks": expected a list.`);
    return [];
  }
  const kept: Webhook[] = [];
  value.forEach((entry, index) => {
    const result = webhookSchema.safeParse(entry);
    if (result.success) {
      kept.push(result.data);
      return;
    }
    warn(`Ignoring webhook ${index}: ${describeIssue(result.error)}.`);
  });
  return kept;
};

const parseSettings = (
  value: unknown,
  warn: (message: string) => void,
): Record<string, DeviceSettings> => {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    warn(`Ignoring "settings": expected an object keyed by device id.`);
    return {};
  }
  const kept: Record<string, DeviceSettings> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^\d+$/.test(key)) {
      // A non-numeric key matches no device, so the setting would have done
      // nothing at all and left the user wondering why.
      warn(`Ignoring device settings for "${key}": not a numeric device id.`);
      continue;
    }
    const result = deviceSettingsSchema.safeParse(entry);
    if (!result.success) {
      warn(`Ignoring device settings for ${key}: ${describeIssue(result.error)}.`);
      continue;
    }
    kept[key] = result.data as DeviceSettings;
  }
  return kept;
};

export const parseConfig = (config: PlatformConfig, env: ConfigEnv = process.env): TydomConfig => {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
  };
  const hostname = asString(config["hostname"]);
  const configuredLocalHostname = asString(config["localHostname"]);
  const localHostname =
    configuredLocalHostname && configuredLocalHostname !== hostname
      ? configuredLocalHostname
      : undefined;
  const username = asString(config["username"]);

  // The base64-encoded env vars take precedence, so a shared config file need
  // not carry the secrets.
  const password = env.HOMEBRIDGE_TYDOM_PASSWORD
    ? decode(env.HOMEBRIDGE_TYDOM_PASSWORD)
    : asString(config["password"]);
  const pin = env.HOMEBRIDGE_TYDOM_PIN
    ? decode(env.HOMEBRIDGE_TYDOM_PIN)
    : asString(config["pin"]) || undefined;

  // Turns `password` above into an account password rather than a gateway one.
  const email = asString(env.HOMEBRIDGE_TYDOM_EMAIL) || asString(config["email"]) || undefined;

  if (!hostname) {
    throw new ConfigError(
      'Missing "hostname" — use "mediation.tydom.com" for remote access, or your gateway\'s local address.',
    );
  }
  if (!username) {
    throw new ConfigError('Missing "username" — this is your Tydom gateway MAC address.');
  }
  if (!password) {
    throw new ConfigError(
      `Missing "password" — ${
        email
          ? `the password of the Delta Dore account ${email}.`
          : 'your gateway\'s password, or set "email" to sign in with your Delta Dore account instead.'
      } Can also be supplied as a base64-encoded HOMEBRIDGE_TYDOM_PASSWORD.`,
    );
  }

  const localeCandidate = asString(env.HOMEBRIDGE_TYDOM_LOCALE) || asString(config["locale"]);
  const locale: TydomLocale = localeCandidate === "en" ? "en" : "fr";

  const refreshSeconds = Number(config["refreshInterval"] ?? DEFAULT_REFRESH_INTERVAL_MS / 1000);
  const refreshIntervalMs = Number.isFinite(refreshSeconds)
    ? Math.max(MIN_REFRESH_INTERVAL_MS, refreshSeconds * 1000)
    : DEFAULT_REFRESH_INTERVAL_MS;

  const primaryRetrySeconds = Number(
    config["primaryRetryInterval"] ?? DEFAULT_PRIMARY_RETRY_INTERVAL_MS / 1000,
  );
  const primaryRetryIntervalMs = Number.isFinite(primaryRetrySeconds)
    ? Math.max(MIN_PRIMARY_RETRY_INTERVAL_MS, primaryRetrySeconds * 1000)
    : DEFAULT_PRIMARY_RETRY_INTERVAL_MS;

  const staleSeconds = Number(config["staleAfter"] ?? DEFAULT_STALE_AFTER_MS / 1000);
  const staleAfterMs =
    Number.isFinite(staleSeconds) && staleSeconds >= 0
      ? staleSeconds * 1000
      : DEFAULT_STALE_AFTER_MS;

  return {
    hostname,
    localHostname,
    username,
    password,
    email,
    pin,
    locale,
    debug: asBoolean(config["debug"], false),
    settings: parseSettings(config["settings"], warn),
    webhooks: parseWebhooks(config["webhooks"], warn),
    includedDevices: asArray(config["includedDevices"]),
    excludedDevices: asArray(config["excludedDevices"]),
    includedCategories: asArray(config["includedCategories"]),
    excludedCategories: asArray(config["excludedCategories"]),
    refreshIntervalMs,
    primaryRetryIntervalMs,
    staleAfterMs,
    warnings,
  };
};
