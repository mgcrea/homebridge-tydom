import chalk from 'chalk';
import {EventEmitter} from 'events';
import {Categories} from 'hap-nodejs';
import {get} from 'lodash';
import {TydomConfigResponse, TydomDeviceDataUpdateBody, TydomMetaResponse} from 'src/typings/tydom';
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
import {chalkJson, chalkNumber, chalkString} from './utils/chalk';
import {getEndpointDetailsFromMeta, resolveEndpointCategory} from './utils/tydom';

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
    debug(`Creating tydom client with username="${username}" and hostname="${hostname}"`);
    this.client = createTydomClient({username, password, hostname, followUpDebounce: 500});
    this.client.on('message', (message) => {
      this.handleMessage(message);
    });
    this.client.on('connect', () => {
      this.log.info(`Successfully connected to Tydom hostname=${hostname} with username="${username}"`);
      this.emit('connect');
    });
    this.client.on('disconnect', () => {
      this.log.warn(`Disconnected from Tydom hostname=${hostname}"`);
      this.emit('disconnect');
    });
  }
  getAccessoryId(deviceId: number) {
    const {username} = this.config;
    return `tydom:${username.slice(6)}:accessories:${deviceId}`;
  }
  async scan() {
    const {hostname, username, settings = {}, includes = [], excludes = []} = this.config;
    try {
      await this.client.connect();
    } catch (err) {
      this.log.error(`Failed to connect to Tydom hostname=${hostname} with username="${username}"`);
      return;
    }
    const config = (await this.client.get('/configs/file')) as TydomConfigResponse;
    const meta = (await this.client.get('/devices/meta')) as TydomMetaResponse;
    const {endpoints} = config;
    endpoints.forEach((endpoint) => {
      const {id_endpoint: endpointId, id_device: deviceId, name: deviceName, first_usage: firstUsage} = endpoint;
      const {metadata} = getEndpointDetailsFromMeta(endpoint, meta);
      const deviceSettings = settings[deviceId] || {};
      const categoryFromSettings = deviceSettings.category as Categories | undefined;
      debug(
        `Found new device with firstUsage=${chalkString(firstUsage)}, deviceId=${chalkNumber(
          deviceId
        )} and endpointId=${chalkNumber(endpointId)}`
      );
      if (includes.length && !includes.includes(`${deviceId}`)) {
        return;
      }
      if (excludes.length && excludes.includes(`${deviceId}`)) {
        return;
      }
      const category = categoryFromSettings || resolveEndpointCategory({firstUsage, metadata});
      if (!category) {
        this.log.warn(`Unsupported firstUsage="${firstUsage}" for endpoint with id="${endpointId}"`);
        debug({endpoint});
        return;
      }
      if (!this.devices.has(deviceId)) {
        const accessoryId = this.getAccessoryId(deviceId);
        const nameFromSetting = get(settings, `${deviceId}.name`) as string | undefined;
        const name = nameFromSetting || deviceName;
        this.devices.set(deviceId, category);
        const context: TydomAccessoryContext = {
          name,
          metadata,
          settings: deviceSettings,
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
