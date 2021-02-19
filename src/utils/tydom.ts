import {Categories} from '../utils/hap';
import {find} from 'lodash';
import {
  TydomConfigEndpoint,
  TydomEndpointData,
  TydomEndpointDataResponse,
  TydomMetaElement,
  TydomMetaResponse,
  AnyTydomDataValue,
  TydomGroupsResponse,
  TydomMetaEndpoint
} from '../typings/tydom';
import assert from '../utils/assert';
import TydomClient from 'tydom-client';
import debug from './debug';
import {sha256Sync} from './hash';
import {URLSearchParams} from 'url';
import type {PlatformAccessory} from 'homebridge';
import {chalkNumber, chalkString} from './chalk';

type DataOperation = {
  promise: Promise<unknown> | null;
  time: number;
};

export type GetTydomDeviceDataOptions = {
  deviceId: number;
  endpointId: number;
  accessory?: PlatformAccessory;
};
const cacheMap = new Map<string, DataOperation>();
const DEBOUNCE_TIME = 1 * 1e3;
export const getTydomDeviceData = async <T extends TydomEndpointData = TydomEndpointData>(
  client: TydomClient,
  {deviceId, endpointId}: GetTydomDeviceDataOptions
): Promise<T> => {
  const now = Date.now();
  const uri = `/devices/${deviceId}/endpoints/${endpointId}/data`;
  if (cacheMap.has(uri)) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const {time, promise} = cacheMap.get(uri)!;
    if (now < time + DEBOUNCE_TIME) {
      return promise as Promise<T>;
    }
  }
  const promise = client.get<TydomEndpointDataResponse>(uri).then((res) => {
    if (res.error > 0) {
      debug(`Received non-zero error=${chalkNumber(res.error)} while querying uri=${chalkString(uri)}`);
      if (res.error > 10) {
        debug(`Accessory with uri=${chalkString(uri)} seems unreacheable (error=${chalkNumber(res.error)}).`);
        throw new Error('UnreacheableAccessory');
      } else {
        debug(`Accessory with uri=${chalkString(uri)} is reporting unknown issues (error=${chalkNumber(res.error)}).`);
      }
    }
    return res.data ? res.data : res;
  }) as Promise<T>;
  cacheMap.set(uri, {time: now, promise});
  return promise;
};

export type RunTydomDeviceCommandOptions = {
  deviceId: number;
  endpointId: number;
  searchParams?: Record<string, string>;
};
export const runTydomDeviceCommand = async <T extends Record<string, unknown> = Record<string, unknown>>(
  client: TydomClient,
  name: string,
  {deviceId, endpointId, searchParams}: RunTydomDeviceCommandOptions
): Promise<T[]> => {
  const now = Date.now();
  const uri = `/devices/${deviceId}/endpoints/${endpointId}/cdata?name=${name}${
    searchParams ? `&${new URLSearchParams(searchParams)}` : ''
  }`;
  if (cacheMap.has(uri)) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const {time, promise} = cacheMap.get(uri)!;
    if (now < time + DEBOUNCE_TIME) {
      return promise as Promise<T[]>;
    }
  }
  const promise = client.command<T>(uri);
  cacheMap.set(uri, {time: now, promise});
  return promise;
};

export const getTydomDataPropValue = <
  V extends AnyTydomDataValue = AnyTydomDataValue,
  T extends TydomEndpointData = TydomEndpointData
>(
  data: T,
  name: string
): V => {
  const item = data.find((prop) => prop.name === name);
  assert(item, `Missing property with name="${name}" in endpoint data`);
  return item.value as V;
};

export const getEndpointDetailsFromMeta = (
  {id_endpoint: endpointId, id_device: deviceId}: TydomConfigEndpoint,
  meta: TydomMetaResponse
): TydomMetaEndpoint => {
  const device = find(meta, {id: deviceId});
  assert(device, `Device with id="${deviceId}" not found in Tydom meta`);
  const details = find(device.endpoints, {id: endpointId});
  assert(details, `Endpoint with id="${endpointId}" not found in device with id="${deviceId}" meta`);
  return details;
};

export const getEndpointGroupIdFromGroups = (
  {id_endpoint: endpointId, id_device: deviceId}: TydomConfigEndpoint,
  groups: TydomGroupsResponse
): number | null => {
  const group = groups.groups.find(({devices}) =>
    devices.some(({id, endpoints}) => id === deviceId && endpoints.some(({id}) => id === endpointId))
  );
  return group ? group.id : null;
};

export const getEndpointSignatureFromMetadata = (metadata: TydomMetaElement[]): string =>
  metadata
    .map((value) => value.name)
    .sort()
    .join('|');

type ResolveEndpointCategoryOptions = {
  firstUsage: string;
  metadata: TydomMetaElement[];
};

const LEGACY_SUPPORTED_CATEGORIES_MAP: Record<string, Categories> = {
  alarm: Categories.SECURITY_SYSTEM,
  belmDoor: Categories.DOOR,
  gate: Categories.GARAGE_DOOR_OPENER,
  garage_door: Categories.GARAGE_DOOR_OPENER,
  hvac: Categories.THERMOSTAT,
  light: Categories.LIGHTBULB,
  shutter: Categories.WINDOW_COVERING,
  window: Categories.WINDOW
};

const ENDPOINTS_SIGNATURES_CATEGORIES: Record<string, Categories> = {
  'alarm:0c6e1d33808fa50a0a921502f80d36430dfaeda5abfed2467f9f2b07821e4842': Categories.SECURITY_SYSTEM, // @maaxleop
  'alarm:aad768ee0367013a974276117fd5ed4834cc26e4d31acc88d35134731331b0e7': Categories.SECURITY_SYSTEM, // @mgcrea.1521931577 (TYXAL+)
  'alarm:6e33f7ee5e62b58f4e888c91a13fd9b9d868f3751cead5ea1252578ba86523a5': Categories.SECURITY_SYSTEM, // @StephanH27.1521931577 (CTX60) #50
  'belmDoor:fb935867933d89b3058f09384f76fd63f3defb18cfb3172f60fa9f4f237f748b': Categories.DOOR, // @mgcrea (MDO)
  'conso:16804a9994bce28275150db329a9c0b931ef7f20608c1a3d2ff248f58569f0d3': Categories.SENSOR, // @maaxleop (STE 2000)
  'gate:83b0912c6fe14622219522922ea0347dcbf86bf9cfd3346a2eca8eac70ca8260': Categories.GARAGE_DOOR_OPENER, // @mgcrea (TYXIA 4620)
  'garage_door:83b0912c6fe14622219522922ea0347dcbf86bf9cfd3346a2eca8eac70ca8260': Categories.GARAGE_DOOR_OPENER, // @Benzoiiit (TYXIA 4620)
  'hvac:1bab47d1dd7e898b5dc2e9867b14dfb8bc9272c4cb0b5d1221da962d43a6ffb4': Categories.THERMOSTAT, // @mgcrea (RF4890)
  'light:449e2a60377094cde10224cee91d378fb0ae373ae6ceea0ac2cbc1ed011bffa7': Categories.LIGHTBULB, // @mgcrea (TYXIA 5610, TYXIA 6610)
  'light:fce45085835f4f2790ea3b17d208b5ace34935444d2535e75ba3f0a2ce86de5f': Categories.LIGHTBULB, // @mgcrea (TYXIA 5650)
  'shutter:c3fe8e2afa864e1a7a5c6676b4287a7b2f2a886a466baec3df8a1ec4f898ad6c': Categories.WINDOW_COVERING, // @maaxleop
  'window:fb935867933d89b3058f09384f76fd63f3defb18cfb3172f60fa9f4f237f748b': Categories.WINDOW // @mgcrea (MDO)
};

export const resolveEndpointCategory = ({firstUsage, metadata}: ResolveEndpointCategoryOptions): Categories | null => {
  // Compute device signature
  const metaSignature = getEndpointSignatureFromMetadata(metadata);
  const hash = `${firstUsage}:${sha256Sync(metaSignature)}`;
  // dir({metaSignature, hash});
  if (ENDPOINTS_SIGNATURES_CATEGORIES[hash]) {
    return ENDPOINTS_SIGNATURES_CATEGORIES[hash];
  }
  debug(`Unknown hash=${hash} with firstUsage="${firstUsage}"`);
  // Fallback on legacy resolution
  if (LEGACY_SUPPORTED_CATEGORIES_MAP[firstUsage]) {
    return LEGACY_SUPPORTED_CATEGORIES_MAP[firstUsage];
  }
  return null;
};

export const asyncWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
