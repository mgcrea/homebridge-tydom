import {Categories} from 'hap-nodejs';
import {PLATFORM_NAME, PLUGIN_NAME} from './config/env';
import TydomController, {ControllerDevicePayload, ControllerUpdatePayload} from './controller';
import {HomebridgeApi, Platform, PlatformAccessory, TydomAccessoryContext} from './typings/homebridge';
import {getTydomAccessoryDataUpdate, getTydomAccessorySetup} from './utils/accessory';
import assert from './utils/assert';
import {chalkNumber} from './utils/chalk';

export type TydomPlatformConfig = {
  platform: string;
  hostname: string;
  username: string;
  password: string;
  settings: Record<string, {name?: string; category?: Categories}>;
  includedDevices?: string[];
  includedCategories?: string[];
  excludedDevices?: string[];
  excludedCategories?: string[];
};

export default class TydomPlatform implements Platform {
  cleanupAccessoriesIds: Set<string> = new Set();
  accessories: Map<string, PlatformAccessory> = new Map();
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

    if (!config) {
      log.warn('Ignoring Tydom platform setup because it is not configured');
      this.disabled = true;
      return;
    }

    this.controller = new TydomController(log, config);
    // Prevent configureAccessory getting called after node ready
    this.api.on('didFinishLaunching', () => setTimeout(() => this.didFinishLaunching(), 16));
    // this.controller.on('connect', () => {});
    this.controller.on('device', this.handleControllerDevice.bind(this));
    this.controller.on('update', this.handleControllerDataUpdate.bind(this));
  }
  async didFinishLaunching() {
    assert(this.controller);
    this.cleanupAccessoriesIds = new Set(this.accessories.keys());
    await this.controller.connect();
    await this.controller.scan();
    this.cleanupAccessoriesIds.forEach((accessoryId) => {
      const accessory = this.accessories.get(accessoryId)!;
      this.log.warn(`Deleting missing accessory with id=${chalkNumber(accessoryId)}`);
      // accessory.updateReachability(false);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    });
    this.log.info(`Properly loaded ${this.accessories.size}-accessories`);
  }
  async handleControllerDevice(context: ControllerDevicePayload) {
    const {name, category, accessoryId} = context;
    const id = this.api.hap.uuid.generate(accessoryId);
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
  handleControllerDataUpdate({type, updates, context}: ControllerUpdatePayload) {
    const id = this.api.hap.uuid.generate(context.accessoryId);
    if (!this.accessories.has(id)) {
      return;
    }
    const accessory = this.accessories.get(id)!;
    const tydomAccessoryUpdate = getTydomAccessoryDataUpdate(accessory);
    if (tydomAccessoryUpdate) {
      tydomAccessoryUpdate(accessory, this.controller!, updates, type);
    }
  }
  async createAccessory(name: string, id: string, category: Categories, context: TydomAccessoryContext) {
    const {platformAccessory: PlatformAccessory} = this.api;
    const {group} = context;
    const accessoryName = category === Categories.WINDOW && group ? group.name || name : name;
    this.log.info(`Creating accessory named="${accessoryName}" with id="${id}"`);
    const accessory = new PlatformAccessory(accessoryName, id, category);
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
