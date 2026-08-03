import type { Logging } from "homebridge";
import type { PluginLogger } from "../api/client.js";
import { debug as debugSink } from "./trace.js";

/**
 * Bridge Homebridge's `Logging` into the structural logger the api layer wants.
 *
 * Two details worth keeping:
 *
 * Homebridge swallows `log.debug` unless the bridge was started with `-D`, so
 * when the user opts into `"debug": true` in the platform config, debug lines
 * are routed to `info` instead. Otherwise turning the option on appears to do
 * nothing.
 *
 * Everything also goes to the `debug` npm sink under the `homebridge-tydom`
 * namespace. `DEBUG=homebridge-tydom` is a documented support workflow with
 * real users behind it, and it costs four lines to keep working.
 */
export const createPluginLogger = (log: Logging, verbose: boolean): PluginLogger => ({
  debug: (message) => {
    debugSink(message);
    if (verbose) {
      log.info(`[debug] ${message}`);
    } else {
      log.debug(message);
    }
  },
  info: (message) => {
    debugSink(message);
    log.info(message);
  },
  warn: (message) => {
    debugSink(message);
    log.warn(message);
  },
  error: (message) => {
    debugSink(message);
    log.error(message);
  },
});
