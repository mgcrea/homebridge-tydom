import { getTydomDataPropValue } from "../api/types.js";
import type { Service } from "homebridge";
import { debugGet, debugGetResult, debugSetUpdate } from "../platform/trace.js";
import type { TydomDeviceSmokeDetectorData } from "../typings/tydom.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/** A DFR TYXAL+ smoke detector. */
export class SmokeDetectorAccessory extends BaseAccessory {
  readonly #service: Service;

  constructor(deps: AccessoryDeps) {
    super(deps);
    const { SmokeDetected, StatusLowBattery } = this.platform.Characteristic;
    this.#service = this.service(this.platform.Service.SmokeSensor);

    this.#service
      .getCharacteristic(SmokeDetected)
      // The gateway reports a flag, not HAP's DETECTED/NOT_DETECTED enum.
      .setProps({ format: "bool" })
      .onGet(async () => {
        debugGet(SmokeDetected, this.#service);
        const data = await this.read<TydomDeviceSmokeDetectorData>();
        const smokeDefect = getTydomDataPropValue<boolean>(data, "techSmokeDefect");
        debugGetResult(SmokeDetected, this.#service, smokeDefect);
        return smokeDefect;
      });

    this.#service.getCharacteristic(StatusLowBattery).onGet(async () => {
      debugGet(StatusLowBattery, this.#service);
      const data = await this.read<TydomDeviceSmokeDetectorData>();
      const battDefect = getTydomDataPropValue<boolean>(data, "battDefect");
      debugGetResult(StatusLowBattery, this.#service, battDefect);
      return this.#batteryLevel(battDefect);
    });
  }

  protected override apply(updates: Record<string, unknown>[]): void {
    const { SmokeDetected, StatusLowBattery } = this.platform.Characteristic;
    for (const { name, value } of updates) {
      switch (name) {
        case "techSmokeDefect": {
          debugSetUpdate(SmokeDetected, this.#service, value);
          this.#service.updateCharacteristic(SmokeDetected, value as boolean);
          break;
        }
        case "battDefect": {
          // The released update path wrote the raw boolean straight into
          // StatusLowBattery while onGet mapped it to the LOW/NORMAL constants.
          // It happened to work because true coerces to 1, but the two paths
          // disagreed; both now go through the same mapping.
          const nextValue = this.#batteryLevel(Boolean(value));
          debugSetUpdate(StatusLowBattery, this.#service, nextValue);
          this.#service.updateCharacteristic(StatusLowBattery, nextValue);
          break;
        }
        default:
          break;
      }
    }
  }

  #batteryLevel(defect: boolean): number {
    const { StatusLowBattery } = this.platform.Characteristic;
    return defect ? StatusLowBattery.BATTERY_LEVEL_LOW : StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }
}

export const createSmokeDetectorAccessory = (deps: AccessoryDeps): SmokeDetectorAccessory =>
  new SmokeDetectorAccessory(deps);
