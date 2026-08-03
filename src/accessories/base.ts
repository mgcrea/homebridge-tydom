import type { PlatformAccessory } from "homebridge";
import type { TydomApiClient } from "../api/client.js";
import type { DeviceType } from "../api/device-type.js";
import type { TydomUpdateType } from "../api/types.js";
import type { Translator } from "../i18n/index.js";
import type TydomPlatform from "../platform.js";
import type { TydomAccessoryContext } from "../typings/tydom.js";

/**
 * What an accessory needs to do its job.
 *
 * Assembled by the platform, which is the composition root — nothing here
 * constructs its own dependencies.
 */
export type AccessoryDeps = {
  platform: TydomPlatform;
  accessory: PlatformAccessory<TydomAccessoryContext>;
  /** The endpoint-facing API. Class-based accessories use this, not `controller`. */
  api: TydomApiClient;
  /**
   * Delta Dore label lookups, already bound to the configured locale.
   *
   * Injected rather than imported, because the tables used to be reached
   * through a module-level Proxy whose target was swapped at construction — the
   * only way to make an import evaluated before the config was read observe the
   * user's `locale`.
   */
  t: Translator;
  /**
   * Raise a user-facing notification (Discord webhooks).
   *
   * Injected rather than emitted back through the controller, which is what
   * created the accessory -> controller -> platform -> accessory cycle.
   */
  notify: (level: "debug" | "info" | "warn", message: string) => void;
};

/**
 * The contract every accessory implements, whether it is a class or a pair of
 * functions behind the adapter.
 */
export type TydomAccessory = {
  /** Apply a state push from the gateway. */
  update(updates: Record<string, unknown>[], type: TydomUpdateType): void | Promise<void>;
  /**
   * Release timers, pending waits and buffered writes. Must be idempotent, and
   * safe to call on an accessory that never finished setting up.
   */
  dispose(): void;
};

export type AccessoryFactory = (deps: AccessoryDeps) => TydomAccessory;

/** Every device type must have exactly one factory; see registry.ts. */
export type AccessoryRegistry = Record<DeviceType, AccessoryFactory>;
