import type { Service } from "homebridge";
import { debugSet, debugSetResult } from "../platform/trace.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/** How long the switch stays "on" before springing back. */
const DEFAULT_DELAY_MS = 1000;

/**
 * A momentary switch: turning it on sends one TOGGLE and it springs back off.
 *
 * Opt-in per device via `settings.<deviceId>.trigger`, for hardware that has no
 * meaningful on/off state — a gate pulse, a doorbell.
 */
export class TriggerSwitchAccessory extends BaseAccessory {
  readonly #service: Service;
  #resetTimer: NodeJS.Timeout | undefined;

  constructor(deps: AccessoryDeps) {
    super(deps);
    const { On } = this.platform.Characteristic;
    const { delay = DEFAULT_DELAY_MS } = this.accessory.context.settings as { delay?: number };
    this.#service = this.service(this.platform.Service.Switch);

    this.#service
      .getCharacteristic(On)
      .onSet(async (value) => {
        debugSet(On, this.#service, value);
        if (!value) {
          return;
        }
        await this.api.putDeviceData(this.deviceId, this.endpointId, [
          { name: "levelCmd", value: "TOGGLE" },
        ]);
        debugSetResult(On, this.#service, value);

        // Tracked rather than a bare setTimeout, so a shutdown or a
        // re-registration mid-pulse does not leave it pending.
        this.clearTimer(this.#resetTimer);
        this.#resetTimer = this.setTimer(() => {
          this.#resetTimer = undefined;
          this.#service.updateCharacteristic(On, false);
        }, delay);
      })
      .updateValue(false);
  }

  /** Nothing to apply: the device has no state this switch reflects. */
  protected override apply(): void {
    // no-op
  }

  override dispose(): void {
    this.#resetTimer = undefined;
    super.dispose();
  }
}

export const createTriggerSwitchAccessory = (deps: AccessoryDeps): TriggerSwitchAccessory =>
  new TriggerSwitchAccessory(deps);
