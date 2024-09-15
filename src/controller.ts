import {EventEmitter} from 'events';
import {Categories, Logging} from 'homebridge';
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
import {stringifyError} from './utils/error';
import {blue, bold, green, yellow} from 'kolorist';

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
  private devices: Map<string, Categories> = new Map();
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
        this.log.error(
          `Encountered an uncaught error=${stringifyError(err)} while processing message=${chalkJson(message)}"`
        );
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
  getUniqueId(deviceId: number, endpointId: number): string {
    return deviceId === endpointId ? `${deviceId}` : `${deviceId}:${endpointId}`;
  }
  getAccessoryId(deviceId: number, endpointId: number): string {
    const {username} = this.config;
    return `tydom:${username.slice(6)}:accessories:${this.getUniqueId(deviceId, endpointId)}`;
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
    this.log.info(`Scaning devices from hostname=${chalkString(hostname)}...`);
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
      const uniqueId = this.getUniqueId(deviceId, endpointId);
      const {metadata} = getEndpointDetailsFromMeta(endpoint, meta);
      const groupId = getEndpointGroupIdFromGroups(endpoint, groups);
      const group = groupId ? configGroups.find(({id}) => id === groupId) : undefined;
      const deviceSettings = settings[deviceId] || {};
      const categoryFromSettings = deviceSettings.category as Categories | undefined;
      // @TODO resolve endpoint productType
      this.log.info(
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
      if (categoryFromSettings) {
        this.log.info(
          `Using overriden category=${chalkNumber(categoryFromSettings)} from settings for deviceId=${chalkNumber(
            deviceId
          )} and endpointId=${chalkNumber(endpointId)}`
        );
      }
      const category =
        categoryFromSettings || resolveEndpointCategory({firstUsage, metadata, settings: deviceSettings});
      if (!category) {
        this.log.warn(`Unsupported firstUsage="${firstUsage}" for endpoint with deviceId="${deviceId}"`);
        debug({endpoint});
        return;
      }
      if (includedCategories.length && !stringIncludes(includedCategories, category)) {
        return;
      }
      if (excludedCategories.length && stringIncludes(excludedCategories, category)) {
        return;
      }
      if (!this.devices.has(uniqueId)) {
        this.log.info(
          `Adding new device with firstUsage=${chalkString(firstUsage)}, deviceId=${chalkNumber(
            deviceId
          )} and endpointId=${chalkNumber(endpointId)}`
        );
        const accessoryId = this.getAccessoryId(deviceId, endpointId);
        const nameFromSetting = get(settings, `${deviceId}.name`) as string | undefined;
        const name = nameFromSetting || deviceName;
        this.devices.set(uniqueId, category);
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
      for (const endpoint of endpoints) {
        const {id: endpointId, data, cdata} = endpoint;
        const updates = type === 'data' ? data : cdata;
        const uniqueId = this.getUniqueId(deviceId, endpointId);
        if (!this.devices.has(uniqueId)) {
          debug(
            `${bold(yellow('←PUT'))}:${blue('ignored')} for device id=${chalkString(
              deviceId
            )} and endpointId=${chalkNumber(endpointId)}`
          );
          return;
        }
        const category = this.devices.get(uniqueId) ?? Categories.OTHER;
        const accessoryId = this.getAccessoryId(deviceId, endpointId);
        debug(
          `${bold(green('←PUT'))}:${blue('update')} for deviceId=${chalkNumber(deviceId)} and endpointId=${chalkNumber(
            endpointId
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
      }
    });
  }
}
