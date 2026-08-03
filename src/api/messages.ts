import type { TydomUpdateType } from "./types.js";

/** One endpoint's worth of pushed state, already flattened out of the frame. */
export type TydomDeviceUpdate = {
  deviceId: number;
  endpointId: number;
  type: TydomUpdateType;
  updates: Record<string, unknown>[];
};

type RawEndpoint = {
  id: number;
  data?: Record<string, unknown>[];
  cdata?: Record<string, unknown>[];
};

type RawDevice = {
  id: number;
  endpoints?: RawEndpoint[];
};

/**
 * Classify an inbound frame from the gateway.
 *
 * `uri` and `method` are nullable on the wire type, so both are accepted as
 * such rather than asserted at every call site.
 */
export const classifyMessage = (
  uri: string | null | undefined,
  method: string | null | undefined,
): TydomUpdateType | "unknown" => {
  if (method !== "PUT") {
    return "unknown";
  }
  if (uri === "/devices/data") {
    return "data";
  }
  if (uri === "/devices/cdata") {
    return "cdata";
  }
  return "unknown";
};

/**
 * Flatten a `/devices/{c,}data` push into one entry per endpoint.
 *
 * Pure, so the frame handling can be tested without a socket.
 *
 * Note the loop uses `continue`: the version this replaces used `return` inside
 * a `for` nested in a `forEach` callback, so a single endpoint the plugin did
 * not know about silently discarded every *remaining* endpoint of that device.
 * Filtering by known device is now the caller's job, which removes the hazard
 * entirely.
 */
export const parseDeviceDataUpdate = (
  body: unknown,
  type: TydomUpdateType,
): TydomDeviceUpdate[] => {
  if (!Array.isArray(body)) {
    return [];
  }

  const result: TydomDeviceUpdate[] = [];
  for (const device of body as RawDevice[]) {
    if (!device || typeof device.id !== "number" || !Array.isArray(device.endpoints)) {
      continue;
    }
    for (const endpoint of device.endpoints) {
      if (!endpoint || typeof endpoint.id !== "number") {
        continue;
      }
      const updates = type === "data" ? endpoint.data : endpoint.cdata;
      if (!Array.isArray(updates)) {
        continue;
      }
      result.push({ deviceId: device.id, endpointId: endpoint.id, type, updates });
    }
  }
  return result;
};

/** `deviceId` when the endpoint is the device itself, `deviceId:endpointId` otherwise. */
export const getUniqueId = (deviceId: number, endpointId: number): string =>
  deviceId === endpointId ? `${deviceId}` : `${deviceId}:${endpointId}`;

/**
 * The stable identity a HomeKit UUID is derived from.
 *
 * Frozen format: `api.hap.uuid.generate` is seeded with this string, so any
 * change re-pairs every accessory and users lose their rooms and automations.
 */
export const getAccessoryId = (username: string, deviceId: number, endpointId: number): string =>
  `tydom:${username.slice(6)}:accessories:${getUniqueId(deviceId, endpointId)}`;
