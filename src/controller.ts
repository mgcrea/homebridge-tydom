import {EventEmitter} from 'events';
import {Categories} from 'hap-nodejs';
import {TydomConfigResponse} from 'src/typings/tydom';
import {assert} from 'src/utils/assert';
import debug from 'src/utils/debug';
import TydomClient, {createClient as createTydomClient} from 'tydom-client';
import {TydomPlatformConfig} from './platform';

export type TydomAccessoryContext = {
  deviceId: number;
  endpointId: number;
  accessoryId: string;
  manufacturer: string;
  serialNumber: string;
  model: string;
};

export type TydomAccessory = {
  name: string;
  id: string;
  category: Categories;
  context: TydomAccessoryContext;
};

const SUPPORTED_CATEGORIES_MAP: Record<string, Categories> = {
  light: Categories.LIGHTBULB,
  hvac: Categories.THERMOSTAT,
  gate: Categories.GARAGE_DOOR_OPENER
};
const SUPPORTED_USAGES = Object.keys(SUPPORTED_CATEGORIES_MAP);

// const getEndpointDetailsfromMeta = (
//   {id_endpoint: endpointId, id_device: deviceId}: TydomConfigEndpoint,
//   meta: TydomMetaResponse
// ) => {
//   const device = find(meta, {id: deviceId});
//   assert(device, `Device with id="${deviceId}" not found in Tydom meta`);
//   const details = find(device.endpoints, {id: endpointId});
//   assert(details, `Endpoint with id="${endpointId}" not found in device with id="${deviceId}" meta`);
//   return details;
// };

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
    const {hostname, username} = this.config;
    try {
      await this.client.connect();
    } catch (err) {
      this.log.error(`Failed to connecto to Tydom hostname=${hostname} with username="${username}"`);
      return;
    }
    const config = (await this.client.get('/configs/file')) as TydomConfigResponse;
    // const meta = (await this.client.get('/devices/meta')) as TydomMetaResponse;
    const {endpoints} = config;
    endpoints.forEach(endpoint => {
      const {id_endpoint: endpointId, id_device: deviceId, name} = endpoint;
      // const {error, metadata} = getEndpointDetailsfromMeta(endpoint, meta);
      // const signature = map(metadata, 'name');
      if (!SUPPORTED_USAGES.includes(endpoint.first_usage)) {
        debug(`Unsupported usage="${endpoint.first_usage}" for endpoint with id="${endpointId}"`);
        debug({endpoint});
        return;
      }
      if (!this.devices.has(deviceId)) {
        this.devices.add(deviceId);
        const accessoryId = this.getAccessoryId(deviceId);
        const category = SUPPORTED_CATEGORIES_MAP[endpoint.first_usage] as Categories;
        const context: TydomAccessoryContext = {
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
        });
      }
    });
  }
}
