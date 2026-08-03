import type { API as Homebridge } from "homebridge";
// Side-effect import: maps stack traces in user bug reports back to the
// TypeScript sources. It has no binding to assign by design.
// oxlint-disable-next-line no-unassigned-import
import "source-map-support/register";
import { PLATFORM_NAME, PLUGIN_NAME } from "./config/env.js";
import { defineHAPGlobals } from "./config/hap.js";
import TydomPlatform from "./platform.js";

export default (homebridge: Homebridge): void => {
  defineHAPGlobals(homebridge);
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TydomPlatform);
};
