import { getTydomDataPropValue } from "../api/types.js";
import type { Service } from "homebridge";
import { debugGet, debugGetResult, debugSetUpdate } from "../platform/trace.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/** An outdoor probe reporting `outTemperature`. */
export class TemperatureSensorAccessory extends BaseAccessory {
  readonly #service: Service;

  constructor(deps: AccessoryDeps) {
    super(deps);
    const { CurrentTemperature } = this.platform.Characteristic;
    this.#service = this.service(this.platform.Service.TemperatureSensor);

    this.#service
      .getCharacteristic(CurrentTemperature)
      // HAP defaults to a 0 °C floor, which a French winter goes below.
      .setProps({ minValue: -100 })
      .onGet(async () => {
        debugGet(CurrentTemperature, this.#service);
        const data = await this.read();
        const outTemperature = getTydomDataPropValue<number>(data, "outTemperature");
        debugGetResult(CurrentTemperature, this.#service, outTemperature);
        return outTemperature;
      });
  }

  protected override apply(updates: Record<string, unknown>[]): void {
    const { CurrentTemperature } = this.platform.Characteristic;
    for (const { name, value } of updates) {
      if (name !== "outTemperature") {
        continue;
      }
      debugSetUpdate(CurrentTemperature, this.#service, value);
      this.#service.updateCharacteristic(CurrentTemperature, value as number);
    }
  }
}

export const createTemperatureSensorAccessory = (deps: AccessoryDeps): TemperatureSensorAccessory =>
  new TemperatureSensorAccessory(deps);
