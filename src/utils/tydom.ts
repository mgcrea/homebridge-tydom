import TydomClient from 'tydom-client';
import {TydomEndpointData, TydomEndpointDataResponse} from 'src/typings/tydom';

type DataOperation = {
  promise: Promise<TydomEndpointData> | null;
  time: number;
};

export type GetTydomDeviceDataOptions = {
  deviceId: number;
  endpointId: number;
};
const cacheMap = new Map<string, DataOperation>();
const DEBOUNCE_TIME = 1 * 1e3;
export const getTydomDeviceData = async (
  client: TydomClient,
  {deviceId, endpointId}: GetTydomDeviceDataOptions
): Promise<TydomEndpointData> => {
  const now = Date.now();
  const uri = `/devices/${deviceId}/endpoints/${endpointId}/data`;
  if (cacheMap.has(uri)) {
    const {time, promise} = cacheMap.get(uri)!;
    if (now < time + DEBOUNCE_TIME) {
      return promise as Promise<TydomEndpointData>;
    }
  }
  const promise = client.get(uri).then(res => {
    if ((res as TydomEndpointDataResponse).data) {
      return (res as TydomEndpointDataResponse).data;
    }
    return res;
  }) as Promise<TydomEndpointData>;
  cacheMap.set(uri, {time: now, promise});
  return promise;
};
