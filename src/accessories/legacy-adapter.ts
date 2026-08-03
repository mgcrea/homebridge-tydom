import type { PlatformAccessory } from "homebridge";
import type { TydomUpdateType } from "../api/types.js";
import type TydomController from "../controller.js";
import { stringifyError } from "../util/error.js";
import type { AccessoryDeps, AccessoryFactory, TydomAccessory } from "./base.js";

/**
 * Bridges the pre-class `setupX` / `updateX` function pairs into the registry.
 *
 * This is what lets the dispatch table land in one commit while the thirteen
 * accessory modules are converted to classes one at a time behind it. Deleted
 * at the end of phase 6, when the last pair is gone.
 */

// The pairs are generic over their own settings/state shapes and cannot be
// expressed uniformly here; the registry is what restores type safety, by
// requiring exactly one factory per DeviceType.
/* oxlint-disable typescript/no-explicit-any */
type LegacySetup = (
  accessory: PlatformAccessory<any>,
  controller: TydomController,
) => void | Promise<void>;

type LegacyUpdate = (
  accessory: PlatformAccessory<any>,
  controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomUpdateType,
) => void | Promise<void>;
/* oxlint-enable typescript/no-explicit-any */

export const fromFunctionPair =
  (setup: LegacySetup, update: LegacyUpdate): AccessoryFactory =>
  ({ accessory, controller, platform }: AccessoryDeps): TydomAccessory => {
    const label = accessory.displayName;

    const settled = Promise.resolve(setup(accessory, controller)).catch((err: unknown) => {
      platform.log.error(`Failed to set up ${label}: ${stringifyError(err as Error)}`);
    });

    return {
      update: (updates, type) => {
        // Setup may still be in flight — several pairs are async, and the
        // gateway can push before they finish. Queueing behind it preserves the
        // ordering the released code got by accident.
        void settled
          .then(() => update(accessory, controller, updates, type))
          .catch((err: unknown) => {
            platform.log.error(`Failed to update ${label}: ${stringifyError(err as Error)}`);
          });
      },
      // The function-pair modules leak their timers by construction; the
      // classes replacing them will not.
      dispose: () => undefined,
    };
  };
