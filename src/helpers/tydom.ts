import type TydomClient from "tydom-client";
import { TydomApiClient, type PluginLogger, type TydomTransport } from "../api/client.js";
import type { AnyTydomDataValue, TydomEndpointData } from "../api/types.js";
import { debug } from "../platform/trace.js";
import { assert } from "../util/assert.js";

/**
 * Transitional shim between the accessories and the api layer.
 *
 * The accessories still receive a raw `tydom-client` and call these helpers
 * directly. Rather than thread a `TydomApiClient` through all fourteen of them
 * now, each raw client is paired with its own api client here — which is enough
 * to kill the module-level read cache this replaces, and with it the leak
 * between two Tydom platforms running in one Homebridge process.
 *
 * Deleted in phase 6, when the accessories take a `TydomDeviceClient` directly.
 */
let shimLogger: PluginLogger = {
  debug: (message) => debug(message),
  info: (message) => debug(message),
  warn: (message) => debug(message),
  error: (message) => debug(message),
};

/**
 * Point the shim at the platform's logger.
 *
 * Without this the api layer's warnings and errors would only ever reach the
 * `debug` sink, so a user not running with DEBUG set would never see them.
 */
export const setShimLogger = (logger: PluginLogger): void => {
  shimLogger = logger;
};

const apiClients = new WeakMap<TydomClient, TydomApiClient>();

/**
 * The api client paired with a raw tydom-client.
 *
 * One per transport, so the class-based accessories and the function pairs
 * still going through the shim share a single read-dedupe window rather than
 * each keeping their own.
 */
export const getApiClient = (client: TydomClient): TydomApiClient => {
  let api = apiClients.get(client);
  if (!api) {
    api = new TydomApiClient({
      transport: client as unknown as TydomTransport,
      // Read through a closure so a logger installed later still applies.
      logger: {
        debug: (m) => shimLogger.debug(m),
        info: (m) => shimLogger.info(m),
        warn: (m) => shimLogger.warn(m),
        error: (m) => shimLogger.error(m),
      },
    });
    apiClients.set(client, api);
  }
  return api;
};

export type GetTydomDeviceDataOptions = {
  deviceId: number;
  endpointId: number;
};

export const getTydomDeviceData = async <T extends TydomEndpointData = TydomEndpointData>(
  client: TydomClient,
  { deviceId, endpointId }: GetTydomDeviceDataOptions,
): Promise<T> => getApiClient(client).getDeviceData<T>(deviceId, endpointId);

export type RunTydomDeviceCommandOptions = {
  deviceId: number;
  endpointId: number;
  searchParams?: Record<string, string>;
};

export const runTydomDeviceCommand = async <
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  client: TydomClient,
  name: string,
  { deviceId, endpointId, searchParams }: RunTydomDeviceCommandOptions,
): Promise<T[]> => getApiClient(client).runCommand<T>(deviceId, endpointId, name, searchParams);

export const getTydomDataPropValue = <
  V extends AnyTydomDataValue = AnyTydomDataValue,
  T extends TydomEndpointData = TydomEndpointData,
>(
  data: T,
  name: string,
): V => {
  const item = data.find((prop) => prop.name === name);
  assert(item, `Missing property with name="${name}" in endpoint data`);
  return item.value as V;
};

export const asyncWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
