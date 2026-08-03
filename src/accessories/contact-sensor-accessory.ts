import { getTydomDataPropValue } from "../api/types.js";
import type { Service } from "homebridge";
import { debugGet, debugGetResult, debugSetUpdate } from "../platform/trace.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/** A door or window opening contact (Delta Dore MDO). */
export class ContactSensorAccessory extends BaseAccessory {
  readonly #service: Service;

  constructor(deps: AccessoryDeps) {
    super(deps);
    const { ContactSensorState } = this.platform.Characteristic;
    this.#service = this.service(this.platform.Service.ContactSensor);

    this.#service.getCharacteristic(ContactSensorState).onGet(async () => {
      debugGet(ContactSensorState, this.#service);
      const data = await this.read();
      const intrusionDetect = getTydomDataPropValue<boolean>(data, "intrusionDetect");
      debugGetResult(ContactSensorState, this.#service, intrusionDetect);
      return intrusionDetect;
    });
  }

  protected override apply(updates: Record<string, unknown>[]): void {
    const { ContactSensorState } = this.platform.Characteristic;
    for (const { name, value } of updates) {
      if (name !== "intrusionDetect") {
        continue;
      }
      debugSetUpdate(ContactSensorState, this.#service, value);
      this.#service.updateCharacteristic(ContactSensorState, value as boolean);
    }
  }
}

export const createContactSensorAccessory = (deps: AccessoryDeps): ContactSensorAccessory =>
  new ContactSensorAccessory(deps);
