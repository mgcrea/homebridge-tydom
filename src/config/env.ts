export const PLUGIN_NAME = "homebridge-tydom";
export const PLATFORM_NAME = "Tydom";
/**
 * The plugin and platform names.
 *
 * Both are frozen: PLATFORM_NAME is the `"platform"` key in every installed
 * user's config.json, and PLUGIN_NAME identifies cached accessories.
 *
 * The HOMEBRIDGE_TYDOM_* environment variables that used to be destructured
 * here are read by parseConfig instead, so they can be tested and so they are
 * resolved after Homebridge has read the config rather than at import time.
 */
export const { DEBUG } = process.env;
