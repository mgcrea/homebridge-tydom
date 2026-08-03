import { getTydomDataPropValue } from "../api/types.js";
import type { Service } from "homebridge";
import {
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
} from "../platform/trace.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/** A metering plug (Delta Dore Easy Plug). */
export class OutletAccessory extends BaseAccessory {
  readonly #service: Service;

  constructor(deps: AccessoryDeps) {
    super(deps);
    const { On, OutletInUse } = this.platform.Characteristic;
    this.#service = this.service(this.platform.Service.Outlet);

    this.#service
      .getCharacteristic(On)
      .onGet(async () => {
        debugGet(On, this.#service);
        const data = await this.read();
        const plugCmd = getTydomDataPropValue<string>(data, "plugCmd");
        const nextValue = plugCmd === "ON";
        debugGetResult(On, this.#service, nextValue);
        return nextValue;
      })
      .onSet(async (value) => {
        debugSet(On, this.#service, value);
        const tydomValue = value ? "ON" : "OFF";
        await this.api.putDeviceData(this.deviceId, this.endpointId, [
          { name: "plugCmd", value: tydomValue },
        ]);
        debugSetResult(On, this.#service, value, tydomValue);
      });

    this.#service.getCharacteristic(OutletInUse).onGet(async () => {
      debugGet(OutletInUse, this.#service);
      const data = await this.read();
      const power = getTydomDataPropValue<number>(data, "energyInstantTotElecP");
      const nextValue = power > 0;
      debugGetResult(OutletInUse, this.#service, nextValue);
      return nextValue;
    });
  }

  protected override apply(updates: Record<string, unknown>[]): void {
    const { On, OutletInUse } = this.platform.Characteristic;
    for (const { name, value } of updates) {
      switch (name) {
        // The released version only handled "level", comparing it to the string
        // "ON" — a test that can never pass for a numeric level, so a pushed
        // state change never reached HomeKit. `plugCmd` is the property this
        // accessory actually reads and writes; `level` is still accepted, but
        // interpreted numerically as it is everywhere else in this plugin.
        case "plugCmd": {
          const nextValue = value === "ON";
          debugSetUpdate(On, this.#service, nextValue);
          this.#service.updateCharacteristic(On, nextValue);
          break;
        }
        case "level": {
          const nextValue = Number(value) > 0;
          debugSetUpdate(On, this.#service, nextValue);
          this.#service.updateCharacteristic(On, nextValue);
          break;
        }
        case "energyInstantTotElecP": {
          const nextValue = Number(value) > 0;
          debugSetUpdate(OutletInUse, this.#service, nextValue);
          this.#service.updateCharacteristic(OutletInUse, nextValue);
          break;
        }
        default:
          break;
      }
    }
  }
}

export const createOutletAccessory = (deps: AccessoryDeps): OutletAccessory =>
  new OutletAccessory(deps);
