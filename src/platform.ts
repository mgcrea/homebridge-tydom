import type {
  DynamicPlatformPlugin,
  API as Homebridge,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import { PLATFORM_NAME, PLUGIN_NAME } from "src/config/env";
import { Categories } from "src/config/hap";
import TydomController, {
  ControllerDevicePayload,
  ControllerNotificationPayload,
  ControllerUpdatePayload,
} from "src/controller";
import { triggerWebhook, Webhook } from "src/helpers";
import { getTydomAccessoryDataUpdate, getTydomAccessorySetup } from "src/helpers/accessory";
import { TydomAccessoryContext } from "src/typings/tydom";
import { assert, chalkKeyword, chalkNumber, chalkString, debug, enableDebug } from "src/utils";

export type TydomPlatformConfig = PlatformConfig & {
  hostname: string;
  username: string;
  password: string;
  settings: Record<string, { name?: string; category?: Categories }>;
  debug?: boolean;
  webhooks?: Webhook[];
  includedDevices?: string[];
  includedCategories?: string[];
  excludedDevices?: string[];
  excludedCategories?: string[];
  refreshInterval?: number;
};

export default class TydomPlatform implements DynamicPlatformPlugin {
  cleanupAccessoriesIds = new Set<string>();
  accessories = new Map<string, PlatformAccessory<TydomAccessoryContext>>();
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

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config) {
      log.warn("Ignoring Tydom platform setup because it is not configured");
      this.disabled = true;
      return;
    }

    if (config.debug) {
      enableDebug();
    }

    this.controller = new TydomController(log, this.config);
    // Prevent configureAccessory getting called after node ready
    this.api.on("didFinishLaunching", () => setTimeout(() => this.didFinishLaunching(), 16));
    // this.controller.on('connect', () => {});
    this.controller.on("device", this.handleControllerDevice.bind(this));
    this.controller.on("update", this.handleControllerDataUpdate.bind(this));
    this.controller.on("notification", this.handleControllerNotification.bind(this));
  }
  async didFinishLaunching(): Promise<void> {
    assert(this.controller);
    this.cleanupAccessoriesIds = new Set(this.accessories.keys());
    await this.controller.connect();
    await this.controller.scan();
    this.cleanupAccessoriesIds.forEach((accessoryId) => {
      const accessory = this.accessories.get(accessoryId);
      if (!accessory) return;
      this.log.warn(`Deleting missing accessory with id=${chalkNumber(accessoryId)}`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    });
    this.log.info(`Properly loaded ${this.accessories.size}-accessories`);
  }
  async handleControllerDevice(context: ControllerDevicePayload): Promise<void> {
    const { name, deviceId, category, accessoryId } = context;
    const id = this.api.hap.uuid.generate(accessoryId);
    this.log.info(
      `Found new tydom device named=${chalkString(name)} with deviceId=${chalkNumber(deviceId)} (id=${chalkKeyword(
        id,
      )})`,
    );
    this.log.debug(
      `Tydom with deviceId=${chalkNumber(deviceId)} (id=${chalkKeyword(id)}) context="${JSON.stringify(context)}"`,
    );
    const existingAccessory = this.accessories.get(id);
    const hasNewCategory = existingAccessory?.category !== category;
    debug(`[${deviceId}] ${existingAccessory?.category} vs ${category}`);
    // Prevent automatic cleanup
    this.cleanupAccessoriesIds.delete(id);
    if (existingAccessory) {
      if (!hasNewCategory) {
        await this.updateAccessory(existingAccessory, context);
        return;
      } else {
        this.log.warn(`Deleting accessory with new category with id=${chalkNumber(accessoryId)}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      }
    }
    const accessory = await this.createAccessory(name, id, category, context);
    this.accessories.set(id, accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }
  handleControllerDataUpdate({ type, updates, context }: ControllerUpdatePayload): void {
    const id = this.api.hap.uuid.generate(context.accessoryId);
    const accessory = this.accessories.get(id);
    if (!accessory || !this.controller) return;
    const tydomAccessoryUpdate = getTydomAccessoryDataUpdate(accessory, context);
    if (tydomAccessoryUpdate) {
      void tydomAccessoryUpdate(accessory, this.controller, updates, type);
    }
  }
  handleControllerNotification({ level, message }: ControllerNotificationPayload): void {
    const { webhooks = [] } = this.config;
    webhooks.forEach((webhook) => {
      void triggerWebhook(webhook, { level, message }).catch((err: unknown) => {
        if (err instanceof Error) {
          this.log.error(`${err.name} ${err.message}`);
          this.log.debug(`${err.stack}`);
        }
      });
    });
  }
  async createAccessory(
    name: string,
    id: string,
    category: Categories,
    context: TydomAccessoryContext,
  ): Promise<PlatformAccessory<TydomAccessoryContext>> {
    const { platformAccessory: PlatformAccessory } = this.api;
    const { group } = context;
    const accessoryName = category === Categories.WINDOW && group ? group.name || name : name;
    this.log.info(
      `Creating accessory named=${chalkString(accessoryName)}, deviceId="${chalkNumber(
        context.deviceId,
      )} (id=${chalkKeyword(id)})"`,
    );
    const accessory = new PlatformAccessory<TydomAccessoryContext>(accessoryName, id, category);
    Object.assign(accessory.context, context);
    await this.updateAccessory(accessory, context);
    return accessory;
  }
  async updateAccessory(
    accessory: PlatformAccessory<TydomAccessoryContext>,
    context: TydomAccessoryContext,
  ): Promise<void> {
    const { displayName: accessoryName, UUID: id } = accessory;
    this.log.info(
      `Updating accessory named=${chalkString(accessoryName)}, deviceId=${chalkNumber(
        context.deviceId,
      )} (id=${chalkKeyword(id)})"`,
    );
    Object.assign(accessory.context, context);
    const tydomAccessorySetup = getTydomAccessorySetup(accessory, context);
    assert(this.controller);
    await tydomAccessorySetup(accessory, this.controller);
    this.api.updatePlatformAccessories([accessory]);
  }
  // Called by homebridge with existing cached accessories
  configureAccessory(accessory: PlatformAccessory<TydomAccessoryContext>): void {
    this.log.debug(`Found cached accessory with id="${accessory.UUID}"`);
    this.accessories.set(accessory.UUID, accessory);
  }
}
