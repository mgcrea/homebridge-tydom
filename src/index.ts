import type { API as Homebridge } from "homebridge";
import { PLATFORM_NAME, PLUGIN_NAME } from "./config/env.js";

// Maps stack traces in user bug reports back to the TypeScript sources.
// Node only maps frames for modules compiled *after* this is enabled, so the
// platform has to be pulled in by the dynamic import below rather than by a
// hoisted static import — that is what splits it into its own chunk. Homebridge
// awaits the plugin module (Plugin.loadPlugin), so the top-level await settles
// before it calls the default export.
process.setSourceMapsEnabled(true);
const { default: TydomPlatform } = await import("./platform.js");

export default (homebridge: Homebridge): void => {
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TydomPlatform);
};
