import { EventEmitter } from "node:events";
import type { Logging } from "homebridge";
import type { Categories } from "homebridge";
import { blue, bold, green, yellow } from "kolorist";
import { discoverDevices } from "./api/discovery.js";
import {
  classifyMessage,
  getAccessoryId,
  getUniqueId,
  parseDeviceDataUpdate,
} from "./api/messages.js";
import type { TydomUpdateType } from "./api/types.js";
import { HOMEBRIDGE_TYDOM_PASSWORD } from "./config/env.js";
import type { TydomAccessoryUpdateType } from "./helpers/accessory.js";
import { asyncWait } from "./helpers/tydom.js";
import type { TydomPlatformConfig } from "./platform.js";
import type {
  TydomAccessoryContext,
  TydomAccessoryUpdateContext,
  TydomConfigResponse,
  TydomGroupsResponse,
  TydomMetaResponse,
} from "./typings/tydom.js";
import { assert } from "./util/assert.js";
import { styleJson, styleNumber, styleString } from "./util/style.js";
import { debug } from "./platform/trace.js";
import { decode } from "./util/hash.js";
import { stringifyError } from "./util/error.js";
import type TydomClient from "tydom-client";
import {
  createClient as createTydomClient,
  type TydomHttpMessage,
  type TydomResponse,
} from "tydom-client";

export type ControllerDevicePayload = TydomAccessoryContext;

export type ControllerUpdatePayload = {
  type: TydomAccessoryUpdateType;
  category: Categories;
  updates: Record<string, unknown>[];
  context: TydomAccessoryContext;
};

export type ControllerNotificationPayload = {
  level: string;
  message: string;
};

const DEFAULT_REFRESH_INTERVAL_SEC = 4 * 60 * 60; // 4 hours

export default class TydomController extends EventEmitter {
  public client: TydomClient;
  public config: TydomPlatformConfig;
  public log: Logging;
  private devices = new Map<string, Categories>();
  private state = new Map<string, unknown>();
  private refreshInterval?: NodeJS.Timeout;
  private hasConnectedOnce = false;
  constructor(log: Logging, config: TydomPlatformConfig) {
    super();
    this.config = config;
    this.log = log;
    const { hostname, username, password: configPassword } = config;
    assert(hostname, 'Missing "hostname" config field for platform');
    assert(username, 'Missing "username" config field for platform');
    const password = HOMEBRIDGE_TYDOM_PASSWORD ? decode(HOMEBRIDGE_TYDOM_PASSWORD) : configPassword;
    assert(password, 'Missing "password" config field for platform');
    this.log.info(
      `Creating tydom client with username=${styleString(username)} and hostname=${styleString(hostname)}`,
    );
    this.client = createTydomClient({ username, password, hostname, followUpDebounce: 500 });
    this.client.on("message", (message: TydomHttpMessage) => {
      try {
        this.handleMessage(message);
      } catch (err) {
        this.log.error(
          `Encountered an uncaught error=${stringifyError(err as Error)} while processing message=${styleJson(message)}"`,
        );
      }
    });
    this.client.on("connect", () => {
      this.log.info(
        `Successfully connected to Tydom hostname=${styleString(hostname)} with username=${styleString(username)}`,
      );
      if (this.hasConnectedOnce) {
        this.log.warn(
          `Reconnected to Tydom hostname=${styleString(hostname)}, re-syncing state...`,
        );
        this.resync().catch((err: unknown) => {
          this.log.error(`Failed to re-sync after reconnection: ${stringifyError(err as Error)}`);
        });
      }
      this.emit("connect");
    });
    this.client.on("disconnect", () => {
      this.log.warn(`Disconnected from Tydom hostname=${styleString(hostname)}"`);
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = undefined;
      }
      this.emit("disconnect");
    });
  }
  getUniqueId(deviceId: number, endpointId: number): string {
    return deviceId === endpointId ? `${deviceId}` : `${deviceId}:${endpointId}`;
  }
  getAccessoryId(deviceId: number, endpointId: number): string {
    const { username } = this.config;
    return `tydom:${username.slice(6)}:accessories:${this.getUniqueId(deviceId, endpointId)}`;
  }
  async connect(): Promise<void> {
    const { hostname, username } = this.config;
    debug(`Connecting to hostname=${styleString(hostname)}...`);
    try {
      await this.client.connect();
      await asyncWait(250);
      // Initial intro handshake
      await this.client.get("/ping");
      this.hasConnectedOnce = true;
      // await asyncWait(250);
      // await this.client.put('/configs/gateway/api_mode');
    } catch (err) {
      this.log.error(`Failed to connect to Tydom hostname=${hostname} with username="${username}"`);
      throw err;
    }
  }
  async sync(): Promise<{
    config: TydomConfigResponse;
    groups: TydomGroupsResponse;
    meta: TydomMetaResponse;
  }> {
    const { hostname, refreshInterval = DEFAULT_REFRESH_INTERVAL_SEC } = this.config;
    debug(`Syncing state from hostname=${styleString(hostname)}...`);
    const config = await this.client.get<TydomConfigResponse>("/configs/file");
    const groups = await this.client.get<TydomGroupsResponse>("/groups/file");
    const meta = await this.client.get<TydomMetaResponse>("/devices/meta");
    // Final outro handshake
    await this.refresh();
    if (this.refreshInterval) {
      debug(`Removing existing refresh interval`);
      clearInterval(this.refreshInterval);
    }
    debug(`Configuring refresh interval of ${styleNumber(Math.round(refreshInterval))}s`);
    this.refreshInterval = setInterval(async () => {
      try {
        await this.refresh();
      } catch (err) {
        debug(`Failed interval refresh with err ${err}`);
      }
    }, refreshInterval * 1000);
    Object.assign(this.state, { config, groups, meta });
    return { config, groups, meta };
  }
  async scan(): Promise<void> {
    const { hostname, username, settings = {} } = this.config;
    this.log.info(`Scanning devices from hostname=${styleString(hostname)}...`);
    const { config, groups, meta } = await this.sync();

    const { devices, skipped } = discoverDevices({
      username,
      config,
      groups,
      meta,
      settings,
      filters: {
        includedDevices: this.config.includedDevices,
        excludedDevices: this.config.excludedDevices,
        includedCategories: this.config.includedCategories,
        excludedCategories: this.config.excludedCategories,
      },
    });

    for (const skip of skipped) {
      if (skip.reason === "unsupported") {
        this.log.warn(
          `Unsupported firstUsage="${skip.firstUsage}" for endpoint with deviceId="${skip.deviceId}"`,
        );
      }
    }

    for (const device of devices) {
      const { uniqueId, deviceId, endpointId, firstUsage, category } = device;
      this.log.info(
        `Found new device with firstUsage=${styleString(firstUsage)}, deviceId=${styleNumber(
          deviceId,
        )} and endpointId=${styleNumber(endpointId)}`,
      );
      if (this.devices.has(uniqueId)) {
        continue;
      }
      this.log.info(
        `Adding new device with firstUsage=${styleString(firstUsage)}, deviceId=${styleNumber(
          deviceId,
        )} and endpointId=${styleNumber(endpointId)}`,
      );
      this.devices.set(uniqueId, category as Categories);
      const context: TydomAccessoryContext = {
        name: device.name,
        category: category as Categories,
        metadata: device.metadata,
        settings: device.settings,
        group: device.group,
        deviceId,
        endpointId,
        accessoryId: device.accessoryId,
        manufacturer: "Delta Dore",
        serialNumber: `ID${deviceId}`,
        state: {},
      };
      this.emit("device", context);
    }
  }
  async refresh(): Promise<void> {
    debug(`Refreshing Tydom controller ...`);
    await this.client.post("/refresh/all");
  }
  private async resync(): Promise<void> {
    const { hostname, refreshInterval = DEFAULT_REFRESH_INTERVAL_SEC } = this.config;
    debug(`Re-syncing state after reconnection to hostname=${styleString(hostname)}...`);
    await asyncWait(250);
    await this.client.get("/ping");
    await this.refresh();
    // Re-establish refresh interval (cleared on disconnect)
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    debug(`Re-configuring refresh interval of ${styleNumber(Math.round(refreshInterval))}s`);
    this.refreshInterval = setInterval(async () => {
      try {
        await this.refresh();
      } catch (err) {
        debug(`Failed interval refresh with err ${err}`);
      }
    }, refreshInterval * 1000);
  }
  handleMessage(message: TydomHttpMessage): void {
    const { uri, method, body } = message;
    const type = classifyMessage(uri, method);
    if (type === "unknown") {
      debug(`Unknown message from Tydom client:\n${styleJson(message)}`);
      return;
    }
    this.handleDeviceDataUpdate(body, type);
  }

  handleDeviceDataUpdate(body: TydomResponse, type: TydomUpdateType): void {
    for (const update of parseDeviceDataUpdate(body, type)) {
      const { deviceId, endpointId, updates } = update;
      const uniqueId = getUniqueId(deviceId, endpointId);
      const category = this.devices.get(uniqueId);
      if (category === undefined) {
        debug(
          `${bold(yellow("\u2190PUT"))}:${blue("ignored")} for device id=${styleString(
            deviceId,
          )} and endpointId=${styleNumber(endpointId)}`,
        );
        continue;
      }
      debug(
        `${bold(green("\u2190PUT"))}:${blue("update")} for deviceId=${styleNumber(
          deviceId,
        )} and endpointId=${styleNumber(endpointId)}, updates:\n${styleJson(updates)}`,
      );
      const context: TydomAccessoryUpdateContext = {
        category,
        deviceId,
        endpointId,
        accessoryId: getAccessoryId(this.config.username, deviceId, endpointId),
      };
      this.emit("update", { type, updates, context } as ControllerUpdatePayload);
    }
  }
}
