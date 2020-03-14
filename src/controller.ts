import {EventEmitter} from 'events';
import {Categories} from 'hap-nodejs';
import {get} from 'lodash';
import {TydomConfigResponse, TydomDeviceUpdateBody, TydomMetaResponse} from 'src/typings/tydom';
import assert from 'src/utils/assert';
import debug from 'src/utils/debug';
import TydomClient, {createClient as createTydomClient} from 'tydom-client';
import {TydomHttpMessage} from 'tydom-client/lib/utils/tydom';
import {TydomPlatformConfig} from './platform';
import {TydomAccessoryContext} from './typings/homebridge';
import {getEndpointDetailsfromMeta} from './utils/tydom';

export type ControllerDevicePayload = {
  name: string;
  category: Categories;
  context: TydomAccessoryContext;
};

export type ControllerUpdatePayload = {
  updates: Record<string, unknown>[];
  context: TydomAccessoryContext;
};

const SUPPORTED_CATEGORIES_MAP: Record<string, Categories> = {
  light: Categories.LIGHTBULB,
  hvac: Categories.THERMOSTAT,
  gate: Categories.GARAGE_DOOR_OPENER,
  shutter: Categories.WINDOW_COVERING,
  alarm: Categories.SECURITY_SYSTEM
};
const SUPPORTED_USAGES = Object.keys(SUPPORTED_CATEGORIES_MAP);

export default class TydomController extends EventEmitter {
  client: TydomClient;
  config: TydomPlatformConfig;
  devices: Set<number>;
  log: typeof console;
  constructor(log: typeof console, config: TydomPlatformConfig) {
    super();
    this.config = config;
    this.log = log;
    this.devices = new Set();
    const {hostname, username, password} = config;
    assert(hostname, 'Missing "hostname" config field for platform');
    assert(username, 'Missing "username" config field for platform');
    assert(password, 'Missing "password" config field for platform');
    debug(`Creating tydom client with username="${username}" and hostname="${hostname}"`);
    this.client = createTydomClient({username, password, hostname});
    this.client.on('message', message => {
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
    const {hostname, username, settings} = this.config;
    try {
      await this.client.connect();
    } catch (err) {
      this.log.error(`Failed to connect to Tydom hostname=${hostname} with username="${username}"`);
      return;
    }
    const config = (await this.client.get('/configs/file')) as TydomConfigResponse;
    const meta = (await this.client.get('/devices/meta')) as TydomMetaResponse;
    const {endpoints} = config;
    endpoints.forEach(endpoint => {
      const {id_endpoint: endpointId, id_device: deviceId, name} = endpoint;
      const {metadata} = getEndpointDetailsfromMeta(endpoint, meta);
      const categoryFromSettings = get(settings, `${deviceId}.category`) as Categories | undefined;
      if (!categoryFromSettings && !SUPPORTED_USAGES.includes(endpoint.first_usage)) {
        debug(`Unsupported usage="${endpoint.first_usage}" for endpoint with id="${endpointId}"`);
        debug({endpoint});
        return;
      }
      const nameFromSetting = get(settings, `${deviceId}.name`) as string | undefined;
      if (!this.devices.has(deviceId)) {
        this.devices.add(deviceId);
        const accessoryId = this.getAccessoryId(deviceId);
        const category = (categoryFromSettings || SUPPORTED_CATEGORIES_MAP[endpoint.first_usage]) as Categories;
        const context: TydomAccessoryContext = {
          name: nameFromSetting || name,
          metadata,
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
      }
    });
  }
  handleMessage(message: TydomHttpMessage) {
    const {uri, method, body} = message;
    const isDeviceUpdate = uri === '/devices/data' && method === 'PUT';
    if (!isDeviceUpdate) {
      debug('Unkown message from Tydom client', message);
      return;
    }
    if (!Array.isArray(body)) {
      debug('Unsupported non-array device update', body);
      return;
    }
    (body as TydomDeviceUpdateBody).forEach(device => {
      const {id: deviceId, endpoints} = device;
      if (!this.devices.has(deviceId)) {
        return;
      }
      const {id: endpointId, data: updates} = endpoints[0];
      const accessoryId = this.getAccessoryId(deviceId);
      debug(`Device with id="${deviceId}" has updated data`, updates);
      const context: Pick<TydomAccessoryContext, 'deviceId' | 'endpointId' | 'accessoryId'> = {
        deviceId,
        endpointId,
        accessoryId
      };
      this.emit('update', {
        updates,
        context
      } as ControllerUpdatePayload);
    });
  }
}
