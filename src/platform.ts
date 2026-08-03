import type {
  DynamicPlatformPlugin,
  API as Homebridge,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import type { Service, Characteristic } from "homebridge";
import type { Categories } from "homebridge";
import type { PluginLogger } from "./api/client.js";
import { CATEGORY, deviceTypeForCategory, type DeviceType } from "./api/device-type.js";
import { ConfigError, parseConfig, type TydomConfig } from "./config.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "./config/env.js";
import { setLocale } from "./config/locale.js";
import { createPluginLogger } from "./platform/logger.js";
import type {
  ControllerDevicePayload,
  ControllerNotificationPayload,
  ControllerUpdatePayload,
} from "./controller.js";
import TydomController from "./controller.js";
import { triggerWebhook } from "./helpers/webhook.js";
import type { TydomAccessory } from "./accessories/base.js";
import { ACCESSORY_REGISTRY } from "./accessories/registry.js";
import { setShimLogger } from "./helpers/tydom.js";
import type { TydomAccessoryContext } from "./typings/tydom.js";
import { assert } from "./util/assert.js";
import { styleKeyword, styleNumber, styleString } from "./util/style.js";
import { debug, enableDebug } from "./platform/trace.js";
import { stringifyError } from "./util/error.js";

/**
 * What the controller reads. Parsed once by `parseConfig`, so nothing
 * downstream ever touches the raw `PlatformConfig` again.
 */
export type TydomPlatformConfig = TydomConfig;

export default class TydomPlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;

  cleanupAccessoriesIds = new Set<string>();
  accessories = new Map<string, PlatformAccessory<TydomAccessoryContext>>();
  /** Live handlers, keyed by the same UUID as `accessories`. */
  handlers = new Map<string, TydomAccessory>();
  controller?: TydomController;
  api: Homebridge;
  config!: TydomPlatformConfig;
  pluginLog?: PluginLogger;
  disabled = false;
  shuttingDown = false;
  log: Logging;

  constructor(log: Logging, config: PlatformConfig, api: Homebridge) {
    this.log = log;
    this.api = api;
    // Injected rather than reached for through the module-level globals in
    // config/hap.ts. Both are the same process-singleton objects, which is what
    // lets converted and unconverted accessories coexist during phase 6.
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    try {
      this.config = parseConfig(config);
    } catch (err) {
      // A misconfigured platform must not take Homebridge down with it. Report
      // it once, clearly, and stay dormant so the rest of the bridge keeps
      // working. The assertions this replaces threw from inside the controller
      // constructor, which surfaced as an unhandled AssertionError.
      this.log.error(
        err instanceof ConfigError ? err.message : `Invalid configuration: ${String(err)}`,
      );
      this.disabled = true;
      return;
    }

    if (this.config.debug) {
      enableDebug();
    }
    setLocale(this.config.locale);
    this.pluginLog = createPluginLogger(log, this.config.debug);
    setShimLogger(this.pluginLog);

    this.controller = new TydomController(log, this.config);
    this.api.on("didFinishLaunching", () => {
      this.didFinishLaunching().catch((err: unknown) => {
        this.log.error(`Failed to finish launching: ${stringifyError(err as Error)}`);
      });
    });
    this.api.on("shutdown", () => {
      this.stop();
    });
    this.controller.on("device", (context: ControllerDevicePayload) => {
      this.handleControllerDevice(context).catch((err: unknown) => {
        this.log.error(
          `Failed to handle device ${context.deviceId}: ${stringifyError(err as Error)}`,
        );
      });
    });
    this.controller.on("update", this.handleControllerDataUpdate.bind(this));
    this.controller.on("notification", this.handleControllerNotification.bind(this));
  }

  /**
   * Release everything that would otherwise keep the process alive or keep
   * talking to a gateway Homebridge is done with. Previously absent entirely:
   * the refresh interval was only ever cleared on an explicit disconnect.
   */
  stop(): void {
    this.shuttingDown = true;
    this.controller?.dispose();
    for (const handler of this.handlers.values()) {
      handler.dispose();
    }
    this.handlers.clear();
  }

  async didFinishLaunching(): Promise<void> {
    assert(this.controller);
    this.cleanupAccessoriesIds = new Set(this.accessories.keys());

    const maxRetries = 10;
    const maxDelay = 5 * 60 * 1000; // 5 minutes
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.shuttingDown) {
        return;
      }
      try {
        await this.controller.connect();
        break;
      } catch (err) {
        if (attempt === maxRetries) {
          this.log.error(
            `Failed to connect after ${maxRetries} retries, giving up: ${stringifyError(err as Error)}`,
          );
          return;
        }
        const delay = Math.min(5000 * Math.pow(2, attempt), maxDelay);
        this.log.warn(
          `Connection attempt ${attempt + 1} failed, retrying in ${Math.round(delay / 1000)}s...`,
        );
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          timer.unref?.();
        });
      }
    }

    await this.controller.scan();
    this.cleanupAccessoriesIds.forEach((accessoryId) => {
      const accessory = this.accessories.get(accessoryId);
      if (!accessory) return;
      this.log.warn(`Deleting missing accessory with id=${styleNumber(accessoryId)}`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    });
    this.log.info(`Properly loaded ${this.accessories.size}-accessories`);
  }
  async handleControllerDevice(context: ControllerDevicePayload): Promise<void> {
    const { name, deviceId, category, accessoryId } = context;
    const id = this.api.hap.uuid.generate(accessoryId);
    this.log.info(
      `Found new tydom device named=${styleString(name)} with deviceId=${styleNumber(deviceId)} (id=${styleKeyword(
        id,
      )})`,
    );
    this.log.debug(
      `Tydom with deviceId=${styleNumber(deviceId)} (id=${styleKeyword(id)}) context="${JSON.stringify(context)}"`,
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
        this.log.warn(`Deleting accessory with new category with id=${styleNumber(accessoryId)}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      }
    }
    const accessory = await this.createAccessory(name, id, category, context);
    this.accessories.set(id, accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }
  handleControllerDataUpdate({ type, updates, context }: ControllerUpdatePayload): void {
    const id = this.api.hap.uuid.generate(context.accessoryId);
    const handler = this.handlers.get(id);
    if (!handler) {
      return;
    }
    try {
      handler.update(updates, type);
    } catch (err) {
      this.log.error(
        `Failed to update accessory ${context.accessoryId}: ${stringifyError(err as Error)}`,
      );
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
  /**
   * The registry key for an accessory.
   *
   * Discovery supplies it directly. A cached accessory registered by an earlier
   * release has only a category, so it is derived — including the settings-driven
   * narrowings the old switch statements applied.
   */
  resolveDeviceType(context: TydomAccessoryContext, category: number): DeviceType | undefined {
    return (
      context.deviceType ??
      deviceTypeForCategory(category, context.settings as never, context.metadata)
    );
  }

  async createAccessory(
    name: string,
    id: string,
    category: Categories,
    context: TydomAccessoryContext,
  ): Promise<PlatformAccessory<TydomAccessoryContext>> {
    const { platformAccessory: PlatformAccessory } = this.api;
    const { group } = context;
    const accessoryName = category === CATEGORY.WINDOW && group ? group.name || name : name;
    this.log.info(
      `Creating accessory named=${styleString(accessoryName)}, deviceId="${styleNumber(
        context.deviceId,
      )} (id=${styleKeyword(id)})"`,
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
      `Updating accessory named=${styleString(accessoryName)}, deviceId=${styleNumber(
        context.deviceId,
      )} (id=${styleKeyword(id)})"`,
    );
    Object.assign(accessory.context, context);
    assert(this.controller);

    const deviceType = this.resolveDeviceType(context, accessory.category);
    if (!deviceType) {
      this.log.warn(
        `Skipping accessory named=${styleString(accessoryName)}: no handler for category=${styleNumber(
          accessory.category,
        )}`,
      );
      return;
    }

    // Re-registering replaces the handler, so the previous one has to let go of
    // its timers first.
    this.handlers.get(id)?.dispose();
    this.handlers.set(
      id,
      ACCESSORY_REGISTRY[deviceType]({ platform: this, accessory, controller: this.controller }),
    );

    this.api.updatePlatformAccessories([accessory]);
  }
  // Called by homebridge with existing cached accessories
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Found cached accessory with id="${accessory.UUID}"`);
    this.accessories.set(accessory.UUID, accessory as PlatformAccessory<TydomAccessoryContext>);
  }
}
