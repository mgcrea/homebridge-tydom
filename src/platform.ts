import type {API as Homebridge, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig} from 'homebridge';
import {PLATFORM_NAME, PLUGIN_NAME} from './config/env';
import {Categories} from './config/hap';
import TydomController, {
  ControllerDevicePayload,
  ControllerNotificationPayload,
  ControllerUpdatePayload
} from './controller';
import {triggerWebhook, Webhook} from './helpers';
import {getTydomAccessoryDataUpdate, getTydomAccessorySetup} from './helpers/accessory';
import {TydomAccessoryContext} from './typings/tydom';
import {assert, chalkKeyword, chalkNumber, chalkString, debug, enableDebug} from './utils';

export type TydomPlatformConfig = PlatformConfig & {
  hostname: string;
  username: string;
  password: string;
  settings: Record<string, {name?: string; category?: Categories}>;
  debug?: boolean;
  webhooks?: Webhook[];
  includedDevices?: string[];
  includedCategories?: string[];
  excludedDevices?: string[];
  excludedCategories?: string[];
  refreshInterval?: number;
};

export default class TydomPlatform implements DynamicPlatformPlugin {
  cleanupAccessoriesIds: Set<string> = new Set();
  accessories: Map<string, PlatformAccessory<TydomAccessoryContext>> = new Map();
  controller?: TydomController;
  api: Homebridge;
  config: TydomPlatformConfig;
  disabled = false;
  log: Logging;

  constructor(log: Logging, config: PlatformConfig, api: Homebridge) {
    // Expose args
    this.config = config as TydomPlatformConfig;
    this.log = log;
    this.api = api;

    if (!config) {
      log.warn('Ignoring Tydom platform setup because it is not configured');
      this.disabled = true;
      return;
    }

    if (config.debug) {
      enableDebug();
    }

    this.controller = new TydomController(log, this.config);
    // Prevent configureAccessory getting called after node ready
    this.api.on('didFinishLaunching', () => setTimeout(() => this.didFinishLaunching(), 16));
    // this.controller.on('connect', () => {});
    this.controller.on('device', this.handleControllerDevice.bind(this));
    this.controller.on('update', this.handleControllerDataUpdate.bind(this));
    this.controller.on('notification', this.handleControllerNotification.bind(this));
  }
  async didFinishLaunching(): Promise<void> {
    assert(this.controller);
    this.cleanupAccessoriesIds = new Set(this.accessories.keys());
    await this.controller.connect();
    await this.controller.scan();
    this.cleanupAccessoriesIds.forEach((accessoryId) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const accessory = this.accessories.get(accessoryId)!;
      this.log.warn(`Deleting missing accessory with id=${chalkNumber(accessoryId)}`);
      // accessory.updateReachability(false);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    });
    this.log.info(`Properly loaded ${this.accessories.size}-accessories`);
  }
  async handleControllerDevice(context: ControllerDevicePayload): Promise<void> {
    const {name, deviceId, category, accessoryId} = context;
    const id = this.api.hap.uuid.generate(accessoryId);
    this.log.info(
      `Found new tydom device named=${chalkString(name)} with deviceId=${chalkNumber(deviceId)} (id=${chalkKeyword(
        id
      )})`
    );
    this.log.debug(
      `Tydom with deviceId=${chalkNumber(deviceId)} (id=${chalkKeyword(id)}) context="${JSON.stringify(context)}"`
    );
    const hasNewCategory = this.accessories.get(id)?.category !== category;
    debug(`[${deviceId}] ${this.accessories.get(id)?.category} vs ${category}`);
    // Prevent automatic cleanup
    this.cleanupAccessoriesIds.delete(id);
    if (this.accessories.has(id)) {
      if (!hasNewCategory) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.updateAccessory(this.accessories.get(id)!, context);
        return;
      } else {
        this.log.warn(`Deleting accessory with new category with id=${chalkNumber(accessoryId)}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessories.get(id)!]);
      }
    }
    const accessory = await this.createAccessory(name, id, category, context);
    this.accessories.set(id, accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }
  handleControllerDataUpdate({type, updates, context}: ControllerUpdatePayload): void {
    const id = this.api.hap.uuid.generate(context.accessoryId);
    if (!this.accessories.has(id)) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const accessory = this.accessories.get(id)!;
    const tydomAccessoryUpdate = getTydomAccessoryDataUpdate(accessory, context);
    if (tydomAccessoryUpdate) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      tydomAccessoryUpdate(accessory, this.controller!, updates, type);
    }
  }
  handleControllerNotification({level, message}: ControllerNotificationPayload): void {
    const {webhooks = []} = this.config;
    webhooks.forEach(async (webhook) => {
      try {
        await triggerWebhook(webhook, {level, message});
      } catch (err) {
        if (err instanceof Error) {
          this.log.error(`${err.name} ${err.message}`);
          this.log.debug(`${err.stack}`);
        }
      }
    });
  }
  async createAccessory(
    name: string,
    id: string,
    category: Categories,
    context: TydomAccessoryContext
  ): Promise<PlatformAccessory<TydomAccessoryContext>> {
    const {platformAccessory: PlatformAccessory} = this.api;
    const {group} = context;
    const accessoryName = category === Categories.WINDOW && group ? group.name || name : name;
    this.log.info(
      `Creating accessory named=${chalkString(accessoryName)}, deviceId="${chalkNumber(
        context.deviceId
      )} (id=${chalkKeyword(id)})"`
    );
    const accessory = new PlatformAccessory<TydomAccessoryContext>(accessoryName, id, category);
    Object.assign(accessory.context, context);
    await this.updateAccessory(accessory, context);
    return accessory;
  }
  async updateAccessory(
    accessory: PlatformAccessory<TydomAccessoryContext>,
    context: TydomAccessoryContext
  ): Promise<void> {
    const {displayName: accessoryName, UUID: id} = accessory;
    this.log.info(
      `Updating accessory named=${chalkString(accessoryName)}, deviceId=${chalkNumber(
        context.deviceId
      )} (id=${chalkKeyword(id)})"`
    );
    Object.assign(accessory.context, context);
    const tydomAccessorySetup = getTydomAccessorySetup(accessory, context);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await tydomAccessorySetup(accessory, this.controller!);
    this.api.updatePlatformAccessories([accessory]);
  }
  // Called by homebridge with existing cached accessories
  configureAccessory(accessory: PlatformAccessory<TydomAccessoryContext>): void {
    this.log.debug(`Found cached accessory with id="${accessory.UUID}"`);
    this.accessories.set(accessory.UUID, accessory);
  }
}
