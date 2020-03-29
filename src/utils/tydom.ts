import {find} from 'lodash';
import {TydomConfigEndpoint, TydomEndpointData, TydomEndpointDataResponse, TydomMetaResponse} from 'src/typings/tydom';
import assert from 'src/utils/assert';
import TydomClient from 'tydom-client';

type DataOperation = {
  promise: Promise<unknown> | null;
  time: number;
};

export type GetTydomDeviceDataOptions = {
  deviceId: number;
  endpointId: number;
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
    const {time, promise} = cacheMap.get(uri)!;
    if (now < time + DEBOUNCE_TIME) {
      return promise as Promise<T>;
    }
  }
  const promise = client.get<TydomEndpointDataResponse>(uri).then((res) => {
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
    const {time, promise} = cacheMap.get(uri)!;
    if (now < time + DEBOUNCE_TIME) {
      return promise as Promise<T[]>;
    }
  }
  const promise = client.command<T>(uri);
  cacheMap.set(uri, {time: now, promise});
  return promise;
};

export const getEndpointDetailsfromMeta = (
  {id_endpoint: endpointId, id_device: deviceId}: TydomConfigEndpoint,
  meta: TydomMetaResponse
) => {
  const device = find(meta, {id: deviceId});
  assert(device, `Device with id="${deviceId}" not found in Tydom meta`);
  const details = find(device.endpoints, {id: endpointId});
  assert(details, `Endpoint with id="${endpointId}" not found in device with id="${deviceId}" meta`);
  return details;
};

export const asyncSetTimeout = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
