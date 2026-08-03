import type { API as Homebridge } from "homebridge";
// Side-effect import: maps stack traces in user bug reports back to the
// TypeScript sources. It has no binding to assign by design.
// oxlint-disable-next-line no-unassigned-import
import "source-map-support/register";
import { PLATFORM_NAME, PLUGIN_NAME } from "src/config/env";
import { defineHAPGlobals } from "src/config/hap";
import TydomPlatform from "src/platform";

export default (homebridge: Homebridge): void => {
  defineHAPGlobals(homebridge);
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TydomPlatform);
};
