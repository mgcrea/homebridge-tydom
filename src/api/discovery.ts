import { stringIncludes } from "../util/basic.js";
import {
  CATEGORY,
  deviceTypeForCategory,
  resolveDeviceType,
  type CategoryValue,
  type DeviceType,
  type ResolutionSettings,
} from "./device-type.js";
import { getAccessoryId, getUniqueId } from "./messages.js";
import type {
  TydomConfigGroup,
  TydomConfigResponse,
  TydomGroupsResponse,
  TydomMetaElement,
  TydomMetaResponse,
} from "./types.js";

/** Per-device settings from the user's platform config. */
export type DeviceSettings = ResolutionSettings &
  Record<string, unknown> & {
    name?: string;
    category?: number;
    sensors?: boolean;
  };

export type DiscoveryFilters = {
  includedDevices?: (string | number)[];
  excludedDevices?: (string | number)[];
  includedCategories?: (string | number)[];
  excludedCategories?: (string | number)[];
};

export type DiscoveredDevice = {
  accessoryId: string;
  uniqueId: string;
  deviceId: number;
  endpointId: number;
  name: string;
  deviceType: DeviceType;
  category: CategoryValue;
  metadata: TydomMetaElement[];
  settings: DeviceSettings;
  group: TydomConfigGroup | undefined;
  firstUsage: string;
  /** Set on a companion accessory, naming the primary it belongs to. */
  companionOf?: string;
};

/** Why an endpoint was not turned into an accessory. Surfaced for logging. */
export type SkippedEndpoint = {
  deviceId: number;
  endpointId: number;
  firstUsage: string;
  reason: "filtered" | "unsupported";
  signatureHash?: string;
};

export type DiscoveryResult = {
  devices: DiscoveredDevice[];
  skipped: SkippedEndpoint[];
};

export const findEndpointMetadata = (
  deviceId: number,
  endpointId: number,
  meta: TydomMetaResponse,
): TydomMetaElement[] | undefined =>
  meta.find(({ id }) => id === deviceId)?.endpoints.find(({ id }) => id === endpointId)?.metadata;

export const findEndpointGroupId = (
  deviceId: number,
  endpointId: number,
  groups: TydomGroupsResponse,
): number | undefined =>
  groups.groups.find(({ devices }) =>
    devices.some(
      ({ id, endpoints }) =>
        id === deviceId && endpoints.some((endpoint) => endpoint.id === endpointId),
    ),
  )?.id;

export type DiscoverDevicesInput = {
  username: string;
  config: TydomConfigResponse;
  groups: TydomGroupsResponse;
  meta: TydomMetaResponse;
  settings?: Record<string, DeviceSettings>;
  filters?: DiscoveryFilters;
};

/**
 * Turn the gateway's config/groups/meta triple into the accessories to register.
 *
 * Pure and framework-free, which is what makes the `accessoryId` format — the
 * seed for every HomeKit UUID — directly testable.
 */
export const discoverDevices = (input: DiscoverDevicesInput): DiscoveryResult => {
  const { username, config, groups, meta, settings = {}, filters = {} } = input;
  const {
    includedDevices = [],
    excludedDevices = [],
    includedCategories = [],
    excludedCategories = [],
  } = filters;

  const devices: DiscoveredDevice[] = [];
  const skipped: SkippedEndpoint[] = [];
  const seen = new Set<string>();

  for (const endpoint of config.endpoints) {
    const {
      id_device: deviceId,
      id_endpoint: endpointId,
      name: deviceName,
      first_usage: firstUsage,
    } = endpoint;

    if (includedDevices.length > 0 && !stringIncludes(includedDevices, deviceId)) {
      skipped.push({ deviceId, endpointId, firstUsage, reason: "filtered" });
      continue;
    }
    if (excludedDevices.length > 0 && stringIncludes(excludedDevices, deviceId)) {
      skipped.push({ deviceId, endpointId, firstUsage, reason: "filtered" });
      continue;
    }

    const userSettings = settings[deviceId] ?? {};
    const metadata = findEndpointMetadata(deviceId, endpointId, meta) ?? [];

    // A numeric `category` in the user's settings pins the endpoint, bypassing
    // signature resolution entirely.
    const override = userSettings.category;
    const resolution =
      override === undefined
        ? resolveDeviceType({ firstUsage, metadata, settings: userSettings })
        : (() => {
            const deviceType = deviceTypeForCategory(override, userSettings, metadata);
            return deviceType
              ? {
                  deviceType,
                  category: override as CategoryValue,
                  impliedSettings: {},
                  signatureHash: "",
                }
              : undefined;
          })();

    if (!resolution) {
      skipped.push({ deviceId, endpointId, firstUsage, reason: "unsupported" });
      continue;
    }

    const { deviceType, category, impliedSettings } = resolution;

    if (includedCategories.length > 0 && !stringIncludes(includedCategories, category)) {
      skipped.push({ deviceId, endpointId, firstUsage, reason: "filtered" });
      continue;
    }
    if (excludedCategories.length > 0 && stringIncludes(excludedCategories, category)) {
      skipped.push({ deviceId, endpointId, firstUsage, reason: "filtered" });
      continue;
    }

    const uniqueId = getUniqueId(deviceId, endpointId);
    if (seen.has(uniqueId)) {
      continue;
    }
    seen.add(uniqueId);

    const groupId = findEndpointGroupId(deviceId, endpointId, groups);
    const group =
      groupId === undefined ? undefined : config.groups.find(({ id }) => id === groupId);

    devices.push({
      accessoryId: getAccessoryId(username, deviceId, endpointId),
      uniqueId,
      deviceId,
      endpointId,
      name: userSettings.name ?? deviceName,
      deviceType,
      category,
      metadata,
      // A fresh object: implied settings must never be written back into the
      // user's live config, which is what the previous Object.assign did.
      settings: { ...userSettings, ...impliedSettings },
      group,
      firstUsage,
    });
  }

  return { devices, skipped };
};

/**
 * Expand devices that HomeKit models as more than one accessory.
 *
 * An alarm also publishes a companion accessory carrying its open-issue and
 * zone contact sensors. That used to be done by the alarm's setup function
 * emitting a synthetic "device" event back into the controller — a cycle that
 * made per-accessory teardown impossible. Deciding it here, once, at discovery
 * time is both cheaper and testable.
 *
 * The `:sensors` suffix and category 110 are byte-identical to the previous
 * implementation so cached companions keep their identity.
 */
export const expandCompanions = (device: DiscoveredDevice): DiscoveredDevice[] => {
  if (device.deviceType !== "alarm" || device.settings.sensors === false) {
    return [device];
  }
  return [
    device,
    {
      ...device,
      deviceType: "alarm-sensors",
      category: CATEGORY.ALARM_SENSORS,
      accessoryId: `${device.accessoryId}:sensors`,
      companionOf: device.accessoryId,
      // Left unset: the display name comes from the locale table, which is not
      // framework-free. The platform fills it in.
      name: device.name,
    },
  ];
};
