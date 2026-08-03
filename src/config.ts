import type { PlatformConfig } from "homebridge";
import type { DeviceSettings } from "./api/discovery.js";
import type { Webhook } from "./helpers/webhook.js";
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

export type TydomLocale = "en" | "fr";

/** The platform's configuration, parsed once and normalised. */
export type TydomConfig = {
  hostname: string;
  username: string;
  password: string;
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
};

export const DEFAULT_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** A refresh is a full `POST /refresh/all`; hammering the gateway helps nobody. */
export const MIN_REFRESH_INTERVAL_MS = 60 * 1000;

const asArray = (value: unknown): (string | number)[] =>
  Array.isArray(value) ? (value as (string | number)[]) : [];

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
  // Present so `process.env` — which carries an index signature — is assignable.
  [key: string]: string | undefined;
};

export const parseConfig = (config: PlatformConfig, env: ConfigEnv = process.env): TydomConfig => {
  const hostname = asString(config["hostname"]);
  const username = asString(config["username"]);

  // The base64-encoded env vars take precedence, so a shared config file need
  // not carry the secrets.
  const password = env.HOMEBRIDGE_TYDOM_PASSWORD
    ? decode(env.HOMEBRIDGE_TYDOM_PASSWORD)
    : asString(config["password"]);
  const pin = env.HOMEBRIDGE_TYDOM_PIN
    ? decode(env.HOMEBRIDGE_TYDOM_PIN)
    : asString(config["pin"]) || undefined;

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
      'Missing "password" — set it in the platform config, or as a base64-encoded HOMEBRIDGE_TYDOM_PASSWORD.',
    );
  }

  const localeCandidate = asString(env.HOMEBRIDGE_TYDOM_LOCALE) || asString(config["locale"]);
  const locale: TydomLocale = localeCandidate === "en" ? "en" : "fr";

  const refreshSeconds = Number(config["refreshInterval"] ?? DEFAULT_REFRESH_INTERVAL_MS / 1000);
  const refreshIntervalMs = Number.isFinite(refreshSeconds)
    ? Math.max(MIN_REFRESH_INTERVAL_MS, refreshSeconds * 1000)
    : DEFAULT_REFRESH_INTERVAL_MS;

  const settings = (config["settings"] ?? {}) as Record<string, DeviceSettings>;

  return {
    hostname,
    username,
    password,
    pin,
    locale,
    debug: asBoolean(config["debug"], false),
    settings: typeof settings === "object" ? settings : {},
    webhooks: Array.isArray(config["webhooks"]) ? (config["webhooks"] as Webhook[]) : [],
    includedDevices: asArray(config["includedDevices"]),
    excludedDevices: asArray(config["excludedDevices"]),
    includedCategories: asArray(config["includedCategories"]),
    excludedCategories: asArray(config["excludedCategories"]),
    refreshIntervalMs,
  };
};
