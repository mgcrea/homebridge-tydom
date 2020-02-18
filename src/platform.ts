import {Categories} from 'hap-nodejs';
import {PLATFORM_NAME, PLUGIN_NAME} from './config/env';
import TydomController, {ControllerDevicePayload, ControllerUpdatePayload, TydomAccessoryContext} from './controller';
import {HomebridgeApi, Platform, PlatformAccessory} from './typings/homebridge';
import {getTydomAccessorySetup, getTydomAccessoryUpdate} from './utils/accessory';

export type TydomPlatformConfig = {
  platform: string;
  hostname: string;
  username: string;
  password: string;
  settings: Record<string, {name?: string; category?: Categories}>;
};

export default class TydomPlatform implements Platform {
  cleanupAccessoriesIds: Set<string>;
  accessories: Map<string, PlatformAccessory>;
  controller?: TydomController;
  api: HomebridgeApi;
  config: TydomPlatformConfig;
  disabled: boolean = false;
  log: typeof console;

  constructor(log: typeof console, config: TydomPlatformConfig, api: HomebridgeApi) {
    // Expose args
    this.config = config;
    this.log = log;
    this.api = api;
    // Internal
    this.accessories = new Map();
    this.cleanupAccessoriesIds = new Set();

    if (!config) {
      log.warn('Ignoring Tydom platform setup because it is not configured');
      this.disabled = true;
      return;
    }

    this.controller = new TydomController(log, config);
    // Prevent configureAccessory getting called after node ready
    this.api.on('didFinishLaunching', () => setTimeout(() => this.didFinishLaunching(), 16));
    this.controller.on('connect', () => {
      this.log.info();
    });
    this.controller.on('device', this.handleControllerDevice.bind(this));
    this.controller.on('update', this.handleControllerUpdate.bind(this));
  }
  async didFinishLaunching() {
    this.cleanupAccessoriesIds = new Set(this.accessories.keys());
    await this.controller!.scan();
    this.cleanupAccessoriesIds.forEach(accessoryId => {
      const accessory = this.accessories.get(accessoryId)!;
      this.log.warn(`Deleting missing accessory with id="${accessoryId}"`);
      // accessory.updateReachability(false);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    });
    this.log.info(`Properly loaded ${this.accessories.size}-accessories`);
  }
  async handleControllerDevice({name, category, context}: ControllerDevicePayload) {
    const id = this.api.hap.uuid.generate(context.accessoryId);
    this.log.info(`Found new tydom device named="${name}" with id="${id}"`);
    this.log.debug(`Tydom device="${id}" context="${JSON.stringify(context)}"`);
    // Prevent automatic cleanup
    this.cleanupAccessoriesIds.delete(id);
    if (this.accessories.has(id)) {
      await this.updateAccessory(this.accessories.get(id)!, context);
      return;
    }
    const accessory = await this.createAccessory(name, id, category, context);
    this.accessories.set(id, accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }
  handleControllerUpdate({updates, context}: ControllerUpdatePayload) {
    const id = this.api.hap.uuid.generate(context.accessoryId);
    this.log.debug(`Tydom device="${id}" update="${JSON.stringify(updates)} with context="${JSON.stringify(context)}"`);
    if (!this.accessories.has(id)) {
      return;
    }
    const accessory = this.accessories.get(id)!;
    const tydomAccessoryUpdate = getTydomAccessoryUpdate(accessory);
    if (tydomAccessoryUpdate) {
      tydomAccessoryUpdate(accessory, updates);
    }
  }
  async createAccessory(name: string, id: string, category: Categories, context: TydomAccessoryContext) {
    this.log.info(`Creating accessory named="${name}" with id="${id}"`);
    const {platformAccessory: PlatformAccessory} = this.api;
    const accessory = new PlatformAccessory(name, id, category);
    Object.assign(accessory.context, context);
    await this.updateAccessory(accessory, context);
    return accessory;
  }
  async updateAccessory(accessory: PlatformAccessory, context: TydomAccessoryContext) {
    const {displayName: name, UUID: id} = accessory;
    this.log.info(`Updating accessory named="${name}" with id="${id}"`);
    Object.assign(accessory.context, context);
    const tydomAccessorySetup = getTydomAccessorySetup(accessory);
    await tydomAccessorySetup(accessory, this.controller!);
    this.api.updatePlatformAccessories([accessory]);
  }
  // Called by homebridge with existing cached accessories
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug(`Found cached accessory with id="${accessory.UUID}"`);
    this.accessories.set(accessory.UUID, accessory);
  }
}
