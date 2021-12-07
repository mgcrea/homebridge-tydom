import chalk from 'chalk';
import {EventEmitter} from 'events';
import type {Categories, Logging} from 'homebridge';
import {get} from 'lodash';
import TydomClient, {createClient as createTydomClient} from 'tydom-client';
import {TydomHttpMessage, TydomResponse} from 'tydom-client/lib/utils/tydom';
import {HOMEBRIDGE_TYDOM_PASSWORD} from './config/env';
import {TydomPlatformConfig} from './platform';
import {TydomAccessoryUpdateType} from './helpers';
import {
  asyncWait,
  getEndpointDetailsFromMeta,
  getEndpointGroupIdFromGroups,
  resolveEndpointCategory
} from './helpers/tydom';
import {
  TydomAccessoryContext,
  TydomAccessoryUpdateContext,
  TydomConfigResponse,
  TydomDeviceDataUpdateBody,
  TydomGroupsResponse,
  TydomMetaResponse
} from './typings/tydom';
import {assert, chalkJson, chalkNumber, chalkString, debug, decode, stringIncludes} from './utils';

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
  private devices: Map<number, Categories> = new Map();
  private state: Map<string, unknown> = new Map();
  private refreshInterval?: NodeJS.Timeout;
  constructor(log: Logging, config: TydomPlatformConfig) {
    super();
    this.config = config;
    this.log = log;
    const {hostname, username, password: configPassword} = config;
    assert(hostname, 'Missing "hostname" config field for platform');
    assert(username, 'Missing "username" config field for platform');
    const password = HOMEBRIDGE_TYDOM_PASSWORD ? decode(HOMEBRIDGE_TYDOM_PASSWORD) : configPassword;
    assert(password, 'Missing "password" config field for platform');
    this.log.info(`Creating tydom client with username=${chalkString(username)} and hostname=${chalkString(hostname)}`);
    this.client = createTydomClient({username, password, hostname, followUpDebounce: 500});
    this.client.on('message', (message) => {
      try {
        this.handleMessage(message);
      } catch (err) {
        this.log.error(`Encountered an uncaught error while processing message=${chalkJson(message)}"`);
        this.log.debug(`${err instanceof Error ? err.stack : err}`);
      }
    });
    this.client.on('connect', () => {
      this.log.info(
        `Successfully connected to Tydom hostname=${chalkString(hostname)} with username=${chalkString(username)}`
      );
      this.emit('connect');
    });
    this.client.on('disconnect', () => {
      this.log.warn(`Disconnected from Tydom hostname=${chalkString(hostname)}"`);
      this.emit('disconnect');
    });
  }
  getAccessoryId(deviceId: number): string {
    const {username} = this.config;
    return `tydom:${username.slice(6)}:accessories:${deviceId}`;
  }
  async connect(): Promise<void> {
    const {hostname, username} = this.config;
    debug(`Connecting to hostname=${chalkString(hostname)}...`);
    try {
      await this.client.connect();
      await asyncWait(250);
      // Initial intro handshake
      await this.client.get('/ping');
      // await asyncWait(250);
      // await this.client.put('/configs/gateway/api_mode');
    } catch (err) {
      this.log.error(`Failed to connect to Tydom hostname=${hostname} with username="${username}"`);
      throw err;
    }
  }
  async sync(): Promise<{config: TydomConfigResponse; groups: TydomGroupsResponse; meta: TydomMetaResponse}> {
    const {hostname, refreshInterval = DEFAULT_REFRESH_INTERVAL_SEC} = this.config;
    debug(`Syncing state from hostname=${chalkString(hostname)}...`);
    const config = await this.client.get<TydomConfigResponse>('/configs/file');
    const groups = await this.client.get<TydomGroupsResponse>('/groups/file');
    const meta = await this.client.get<TydomMetaResponse>('/devices/meta');
    // Final outro handshake
    await this.refresh();
    if (this.refreshInterval) {
      debug(`Removing existing refresh interval`);
      clearInterval(this.refreshInterval);
    }
    debug(`Configuring refresh interval of ${chalkNumber(Math.round(refreshInterval))}s`);
    this.refreshInterval = setInterval(async () => {
      try {
        await this.refresh();
      } catch (err) {
        debug(`Failed interval refresh with err ${err}`);
      }
    }, refreshInterval * 1000);
    Object.assign(this.state, {config, groups, meta});
    return {config, groups, meta};
  }
  async scan(): Promise<void> {
    const {hostname} = this.config;
    debug(`Scaning devices from hostname=${chalkString(hostname)}...`);
    const {
      settings = {},
      includedDevices = [],
      excludedDevices = [],
      includedCategories = [],
      excludedCategories = []
    } = this.config;
    const {config, groups, meta} = await this.sync();
    const {endpoints, groups: configGroups} = config;
    endpoints.forEach((endpoint) => {
      const {id_endpoint: endpointId, id_device: deviceId, name: deviceName, first_usage: firstUsage} = endpoint;
      const {metadata} = getEndpointDetailsFromMeta(endpoint, meta);
      const groupId = getEndpointGroupIdFromGroups(endpoint, groups);
      const group = groupId ? configGroups.find(({id}) => id === groupId) : undefined;
      const deviceSettings = settings[deviceId] || {};
      const categoryFromSettings = deviceSettings.category as Categories | undefined;
      // @TODO resolve endpoint productType
      debug(
        `Found new device with firstUsage=${chalkString(firstUsage)}, deviceId=${chalkNumber(
          deviceId
        )} and endpointId=${chalkNumber(endpointId)}`
      );
      if (includedDevices.length && !stringIncludes(includedDevices, deviceId)) {
        return;
      }
      if (excludedDevices.length && stringIncludes(excludedDevices, deviceId)) {
        return;
      }
      const category = categoryFromSettings || resolveEndpointCategory({firstUsage, metadata});
      if (!category) {
        this.log.warn(`Unsupported firstUsage="${firstUsage}" for endpoint with id="${endpointId}"`);
        debug({endpoint});
        return;
      }
      if (includedCategories.length && !stringIncludes(includedCategories, category)) {
        return;
      }
      if (excludedCategories.length && stringIncludes(excludedCategories, category)) {
        return;
      }
      if (!this.devices.has(deviceId)) {
        debug(
          `Adding new device with firstUsage=${chalkString(firstUsage)}, deviceId=${chalkNumber(
            deviceId
          )} and endpointId=${chalkNumber(endpointId)}`
        );
        const accessoryId = this.getAccessoryId(deviceId);
        const nameFromSetting = get(settings, `${deviceId}.name`) as string | undefined;
        const name = nameFromSetting || deviceName;
        this.devices.set(deviceId, category);
        const context: TydomAccessoryContext = {
          name,
          category,
          metadata,
          settings: deviceSettings,
          group,
          deviceId,
          endpointId,
          accessoryId,
          manufacturer: 'Delta Dore',
          serialNumber: `ID${deviceId}`,
          // model: 'N/A',
          state: {}
        };
        this.emit('device', context);
      }
    });
  }
  async refresh(): Promise<unknown> {
    debug(`Refreshing Tydom controller ...`);
    return await this.client.post('/refresh/all');
  }
  handleMessage(message: TydomHttpMessage): void {
    const {uri, method, body} = message;
    const isDeviceUpdate = uri === '/devices/data' && method === 'PUT';
    if (isDeviceUpdate) {
      this.handleDeviceDataUpdate(body, 'data');
      return;
    }
    const isDeviceCommandUpdate = uri === '/devices/cdata' && method === 'PUT';
    if (isDeviceCommandUpdate) {
      this.handleDeviceDataUpdate(body, 'cdata');
      return;
    }
    debug(`Unkown message from Tydom client:\n${chalkJson(message)}`);
  }
  handleDeviceDataUpdate(body: TydomResponse, type: 'data' | 'cdata'): void {
    if (!Array.isArray(body)) {
      debug('Unsupported non-array device update', body);
      return;
    }
    (body as TydomDeviceDataUpdateBody).forEach((device) => {
      const {id: deviceId, endpoints} = device;
      if (!this.devices.has(deviceId)) {
        debug(
          `${chalk.bold.yellow('←PUT')}:${chalk.blue('ignored')} for device id=${chalkString(
            deviceId
          )}, endpoints:\n${chalkJson(endpoints)}`
        );
        return;
      }
      const category = this.devices.get(deviceId) as Categories;
      const {id: endpointId, data, cdata} = endpoints[0];
      const updates = type === 'data' ? data : cdata;
      const accessoryId = this.getAccessoryId(deviceId);
      debug(
        `${chalk.bold.green('←PUT')}:${chalk.blue('update')} for device id=${chalkString(
          deviceId
        )}, updates:\n${chalkJson(updates)}`
      );
      const context: TydomAccessoryUpdateContext = {
        category,
        deviceId,
        endpointId,
        accessoryId
      };
      this.emit('update', {
        type,
        updates,
        context
      } as ControllerUpdatePayload);
    });
  }
}
