import chalk from 'chalk';
import {EventEmitter} from 'events';
import {Categories} from 'hap-nodejs';
import {get} from 'lodash';
import {
  TydomConfigResponse,
  TydomDeviceDataUpdateBody,
  TydomGroupsResponse,
  TydomMetaResponse
} from 'src/typings/tydom';
import assert from 'src/utils/assert';
import debug from 'src/utils/debug';
import {decode} from 'src/utils/hash';
import TydomClient, {createClient as createTydomClient} from 'tydom-client';
import {TydomHttpMessage, TydomResponse} from 'tydom-client/lib/utils/tydom';
import {HOMEBRIDGE_TYDOM_PASSWORD} from './config/env';
import locale from './config/locale';
import {TydomPlatformConfig} from './platform';
import {TydomAccessoryContext, TydomAccessoryUpdateContext} from './typings/homebridge';
import {SECURITY_SYSTEM_SENSORS} from './utils/accessory';
import {stringIncludes} from './utils/array';
import {chalkJson, chalkNumber, chalkString} from './utils/chalk';
import {
  getEndpointDetailsFromMeta,
  getEndpointGroupIdFromGroups,
  resolveEndpointCategory,
  asyncWait
} from './utils/tydom';

export type ControllerDevicePayload = {
  name: string;
  category: Categories;
  context: TydomAccessoryContext;
};

export type ControllerUpdatePayload = {
  category: Categories;
  updates: Record<string, unknown>[];
  context: TydomAccessoryContext;
};

export default class TydomController extends EventEmitter {
  client: TydomClient;
  config: TydomPlatformConfig;
  devices: Map<number, Categories> = new Map();
  state: Map<string, unknown> = new Map();
  log: typeof console;
  constructor(log: typeof console, config: TydomPlatformConfig) {
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
      this.handleMessage(message);
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
  getAccessoryId(deviceId: number) {
    const {username} = this.config;
    return `tydom:${username.slice(6)}:accessories:${deviceId}`;
  }
  async connect() {
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
  async sync() {
    const {hostname} = this.config;
    debug(`Syncing state from hostname=${chalkString(hostname)}...`);
    const config = await this.client.get<TydomConfigResponse>('/configs/file');
    const groups = await this.client.get<TydomGroupsResponse>('/groups/file');
    const meta = await this.client.get<TydomMetaResponse>('/devices/meta');
    // Final outro handshake
    await this.refresh();
    Object.assign(this.state, {config, groups, meta});
    return {config, groups, meta};
  }
  async scan() {
    const {hostname} = this.config;
    debug(`Scaning devicesd from hostname=${chalkString(hostname)}...`);
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
          metadata,
          settings: deviceSettings,
          group,
          deviceId,
          endpointId,
          accessoryId,
          manufacturer: 'Delta Dore',
          serialNumber: `${deviceId}`,
          model: 'N/A'
        };
        this.emit('device', {
          name,
          category,
          context
        } as ControllerDevicePayload);
        // Create a special extra device for SECURITY_SYSTEM.sensors
        if (category === Categories.SECURITY_SYSTEM) {
          const extraAccessoryId = `${accessoryId}:sensors`;
          const extraName = `${get(locale, 'ALARME_ISSUES_OUVERTES', 'N/A') as string}`;
          const extraCategory = SECURITY_SYSTEM_SENSORS;
          const extraContext: TydomAccessoryContext = {
            ...context,
            name: extraName,
            accessoryId: extraAccessoryId
          };
          this.emit('device', {
            name: extraName,
            category: extraCategory,
            context: extraContext
          } as ControllerDevicePayload);
        }
      }
    });
  }
  async refresh() {
    debug(`Refreshing Tydom controller ...`);
    return await this.client.post('/refresh/all');
  }
  handleMessage(message: TydomHttpMessage) {
    const {uri, method, body} = message;
    const isDeviceUpdate = uri === '/devices/data' && method === 'PUT';
    if (isDeviceUpdate) {
      this.handleDeviceDataUpdate(body);
      return;
    }
    debug('Unkown message from Tydom client', message);
  }
  handleDeviceDataUpdate(body: TydomResponse) {
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
      const {id: endpointId, data: updates} = endpoints[0];
      const accessoryId = this.getAccessoryId(deviceId);
      debug(
        `${chalk.bold.green('←PUT')}:${chalk.blue('update')} for device id=${chalkString(
          deviceId
        )}, updates:\n${chalkJson(updates)}`
      );
      const context: TydomAccessoryUpdateContext = {
        deviceId,
        endpointId,
        accessoryId
      };
      this.emit('update', {
        updates,
        category,
        context
      } as ControllerUpdatePayload);
      // Create a special extra update for SECURITY_SYSTEM.sensors
      if (category === Categories.SECURITY_SYSTEM) {
        const extraAccessoryId = `${accessoryId}:sensors`;
        const extraCategory = SECURITY_SYSTEM_SENSORS;
        const extraContext: TydomAccessoryUpdateContext = {
          ...context,
          accessoryId: extraAccessoryId
        };
        this.emit('update', {
          updates,
          category: extraCategory,
          context: extraContext
        } as ControllerUpdatePayload);
      }
    });
  }
}
