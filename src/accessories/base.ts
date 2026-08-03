import type { PlatformAccessory } from "homebridge";
import type { DeviceType } from "../api/device-type.js";
import type { TydomUpdateType } from "../api/types.js";
import type TydomController from "../controller.js";
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
  /**
   * The controller.
   *
   * Present only for the function-pair modules still going through
   * legacy-adapter.ts. Phase 6 replaces it with a per-endpoint device client,
   * which is what finally severs accessory -> controller.
   */
  controller: TydomController;
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
