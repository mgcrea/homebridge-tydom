import type {
  DynamicPlatformPlugin,
  API as Homebridge,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import type { Service, Characteristic } from "homebridge";
import type { Categories } from "homebridge";
import { TydomApiClient, type PluginLogger, type TydomTransport } from "./api/client.js";
import { CATEGORY, deviceTypeForCategory, type DeviceType } from "./api/device-type.js";
import { ConfigError, parseConfig, type TydomConfig } from "./config.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "./config/env.js";
import { createTranslator, type Translator } from "./i18n/index.js";
import { createPluginLogger } from "./platform/logger.js";
import type { ControllerDevicePayload, ControllerUpdatePayload } from "./controller.js";
import TydomController from "./controller.js";
import { triggerWebhook, type NotificationPayload } from "./helpers/webhook.js";
import type { TydomAccessory } from "./accessories/base.js";
import { ACCESSORY_REGISTRY } from "./accessories/registry.js";
import type { TydomAccessoryContext } from "./typings/tydom.js";
import { assert } from "./util/assert.js";
import { DeltaDoreAuthError } from "./util/deltadore.js";
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
  /**
   * Primary accessory UUID -> the UUIDs of companions that share its endpoint.
   *
   * The alarm and its sensors accessory sit on one deviceId/endpointId, so the
   * gateway only ever addresses one of them. The alarm used to relay its own
   * updates to the companion by emitting back into the controller — a cycle
   * that made per-accessory teardown impossible. The platform fans out instead.
   */
  companions = new Map<string, string[]>();
  /**
   * The `device` handlers still in flight.
   *
   * The controller announces every device synchronously from `scan`, but the
   * handler is async and only reaches `accessories.set` after two awaits, so
   * nothing it registers has landed when `scan` resolves. The startup sweep and
   * the count used to run right there — which is why a fully populated gateway
   * reported `Properly loaded 0-accessories`.
   */
  pendingDevices = new Set<Promise<void>>();
  controller?: TydomController;
  /**
   * The endpoint-facing API, handed to every accessory.
   *
   * One per platform, which is what keeps the read-dedupe window from leaking
   * between two Tydom gateways in a single Homebridge process — it used to be a
   * module-level cache, so the second platform to start served the first one's
   * readings.
   */
  apiClient?: TydomApiClient;
  api: Homebridge;
  config!: TydomPlatformConfig;
  /** Delta Dore label lookups, bound to the configured locale. */
  t!: Translator;
  pluginLog?: PluginLogger;
  disabled = false;
  shuttingDown = false;
  log: Logging;

  constructor(log: Logging, config: PlatformConfig, api: Homebridge) {
    this.log = log;
    this.api = api;
    // Injected rather than reached for through module-level globals, so an
    // accessory's HAP dependency arrives through its constructor like
    // everything else it needs.
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

    // Recoverable config problems: a dropped webhook or device-settings entry.
    // Reported at warn so they are visible without `-D`, since the user would
    // otherwise just find the feature quietly not working.
    for (const warning of this.config.warnings) {
      this.log.warn(warning);
    }

    if (this.config.debug) {
      enableDebug();
    }
    this.t = createTranslator(this.config.locale);
    this.pluginLog = createPluginLogger(log, this.config.debug);

    this.controller = new TydomController(log, this.config);
    const controller = this.controller;
    this.apiClient = new TydomApiClient({
      // Resolved per call rather than captured: with account credentials the
      // controller replaces its client once `connect` has fetched the gateway
      // password, and a transport bound to the placeholder would keep talking
      // to the client that never connected.
      //
      // tydom-client's methods are generic over the response type; the
      // transport seam deliberately is not, so it can be faked in tests.
      transport: controller.transport satisfies TydomTransport,
      logger: this.pluginLog,
    });
    this.api.on("didFinishLaunching", () => {
      this.didFinishLaunching().catch((err: unknown) => {
        this.log.error(`Failed to finish launching: ${stringifyError(err as Error)}`);
      });
    });
    this.api.on("shutdown", () => {
      this.stop();
    });
    this.controller.on("device", (context: ControllerDevicePayload) => {
      const pending = this.handleControllerDevice(context)
        .catch((err: unknown) => {
          this.log.error(
            `Failed to handle device ${context.deviceId}: ${stringifyError(err as Error)}`,
          );
        })
        .finally(() => {
          this.pendingDevices.delete(pending);
        });
      this.pendingDevices.add(pending);
    });
    this.controller.on("update", this.handleControllerDataUpdate.bind(this));
    // No "notification" listener: the controller never emits one. Accessories
    // raise notifications through the `notify` callback injected below, which is
    // what broke the accessory -> controller -> platform -> accessory cycle.
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
    this.companions.clear();
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
      // `tydom-client` reconnects on its own, so a socket may already have come
      // up while this ladder was waiting out its backoff. Asking for another
      // one opens a second socket and drives a second scan.
      if (attempt > 0 && this.controller.isConnected) {
        this.log.info("A connection came up while retrying; continuing with it.");
        break;
      }
      try {
        await this.controller.connect();
        break;
      } catch (err) {
        if (err instanceof DeltaDoreAuthError) {
          // Delta Dore rejected the account credentials. Retrying re-submits the
          // same wrong password to Azure AD B2C every few minutes, which earns a
          // lockout and never a connection, so stop here and say what to fix.
          this.log.error(err.message);
          return;
        }
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
    await this.settlePendingDevices();
    this.cleanupAccessoriesIds.forEach((accessoryId) => {
      const accessory = this.accessories.get(accessoryId);
      if (!accessory) return;
      this.log.warn(`Deleting missing accessory with id=${styleNumber(accessoryId)}`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.forgetAccessory(accessoryId);
    });
    this.log.info(`Properly loaded ${this.accessories.size}-accessories`);
  }

  /**
   * Drain the announced-device handlers.
   *
   * Looping rather than awaiting once covers a handler that itself announces
   * more work; the `finally` that empties the set is attached before
   * `allSettled` subscribes, so the loop always terminates.
   */
  async settlePendingDevices(): Promise<void> {
    while (this.pendingDevices.size > 0) {
      await Promise.allSettled(this.pendingDevices);
    }
  }

  /**
   * Drop every trace of an accessory the platform no longer owns.
   *
   * `unregisterPlatformAccessories` only tells Homebridge; the platform's own
   * tables used to keep the entry. That inflated the `Properly loaded` count by
   * every accessory the sweep had just removed, and left the handler holding
   * its timers and the companion links pointing at an accessory that is gone.
   *
   * `pruneCompanions` is false when the accessory is about to be rebuilt under
   * the same UUID: the links are keyed by the primary but written by the
   * companion's own pass, and the controller announces each accessory once.
   */
  forgetAccessory(id: string, { pruneCompanions = true } = {}): void {
    this.accessories.delete(id);
    this.handlers.get(id)?.dispose();
    this.handlers.delete(id);
    if (!pruneCompanions) {
      return;
    }
    this.companions.delete(id);
    for (const [primaryId, companionIds] of this.companions) {
      if (!companionIds.includes(id)) {
        continue;
      }
      const remaining = companionIds.filter((companionId) => companionId !== id);
      if (remaining.length > 0) {
        this.companions.set(primaryId, remaining);
      } else {
        this.companions.delete(primaryId);
      }
    }
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
        // Rebuilt under the same UUID two lines down, so its companion links
        // have to survive — the companion's own pass already wrote them.
        this.forgetAccessory(id, { pruneCompanions: false });
      }
    }
    const accessory = await this.createAccessory(name, id, category, context);
    // Wire the services up first, then hand the finished accessory over.
    // `registerPlatformAccessories` is what stamps the plugin association, and
    // it is the only Homebridge call that may be the first one an accessory
    // ever sees: `updatePlatformAccessories` on an unassociated accessory makes
    // `PlatformAccessory.serialize` throw, which aborts the whole cache write.
    await this.configureHandler(accessory, context);
    this.accessories.set(id, accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }
  handleControllerDataUpdate({ type, updates, context }: ControllerUpdatePayload): void {
    const id = this.api.hap.uuid.generate(context.accessoryId);
    for (const target of [id, ...(this.companions.get(id) ?? [])]) {
      const handler = this.handlers.get(target);
      if (!handler) {
        continue;
      }
      try {
        handler.update(updates, type);
      } catch (err) {
        this.log.error(
          `Failed to update accessory ${context.accessoryId}: ${stringifyError(err as Error)}`,
        );
      }
    }
  }

  handleControllerNotification({ level, message }: NotificationPayload): void {
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
    return accessory;
  }
  /**
   * Re-configure an accessory Homebridge already knows about, and persist it.
   *
   * Only ever call this on an accessory that came back from `configureAccessory`
   * or that has already been through `registerPlatformAccessories` — those are
   * the only two ways an accessory gets its plugin association, and without one
   * the cache write below throws and takes every other accessory down with it.
   */
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
    if (!(await this.configureHandler(accessory, context))) {
      return;
    }
    this.api.updatePlatformAccessories([accessory]);
  }
  /**
   * Attach (or re-attach) the handler and its companion links.
   *
   * Deliberately touches no Homebridge persistence, so it is safe to run on an
   * accessory that has not been registered yet. Returns whether a handler was
   * actually wired, so callers can skip persisting a category they cannot serve.
   */
  async configureHandler(
    accessory: PlatformAccessory<TydomAccessoryContext>,
    context: TydomAccessoryContext,
  ): Promise<boolean> {
    const { displayName: accessoryName, UUID: id } = accessory;
    Object.assign(accessory.context, context);
    assert(this.apiClient);

    const deviceType = this.resolveDeviceType(context, accessory.category);
    if (!deviceType) {
      this.log.warn(
        `Skipping accessory named=${styleString(accessoryName)}: no handler for category=${styleNumber(
          accessory.category,
        )}`,
      );
      return false;
    }

    if (context.companionOf) {
      const primaryId = this.api.hap.uuid.generate(context.companionOf);
      const existing = this.companions.get(primaryId) ?? [];
      if (!existing.includes(id)) {
        this.companions.set(primaryId, [...existing, id]);
      }
    }

    // Re-registering replaces the handler, so the previous one has to let go of
    // its timers first.
    this.handlers.get(id)?.dispose();
    this.handlers.set(
      id,
      ACCESSORY_REGISTRY[deviceType]({
        platform: this,
        accessory,
        api: this.apiClient,
        t: this.t,
        notify: (level, message) => {
          this.handleControllerNotification({ level, message });
        },
      }),
    );

    return true;
  }
  // Called by homebridge with existing cached accessories
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Found cached accessory with id="${accessory.UUID}"`);
    this.accessories.set(accessory.UUID, accessory as PlatformAccessory<TydomAccessoryContext>);
  }
}
