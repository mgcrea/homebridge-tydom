import type { Service } from "homebridge";
import type { ServiceClass } from "../helpers/accessory.js";
import { getTydomDataPropValue } from "../helpers/tydom.js";
import {
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
} from "../platform/trace.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/**
 * A device driven by a single `level` property that only ever reads 0 or 100.
 *
 * Three HomeKit accessory types share this behaviour and differ only in which
 * service they publish: a switch, a fan, and a non-dimmable light. They used to
 * be three modules plus a shared `switchableService` helper — four files for one
 * behaviour, and the light re-derived its own dimmability in two places.
 */
export abstract class SwitchableAccessory extends BaseAccessory {
  /**
   * A getter, not a field: it is read during construction, and subclass field
   * initialisers do not run until after `super()` returns.
   */
  protected abstract get serviceClass(): ServiceClass;

  #service: Service | undefined;

  constructor(deps: AccessoryDeps) {
    super(deps);
    this.#setup();
  }

  protected get switchService(): Service {
    this.#service ??= this.service(this.serviceClass);
    return this.#service;
  }

  #setup(): void {
    const { On } = this.platform.Characteristic;
    const service = this.switchService;

    service
      .getCharacteristic(On)
      .onGet(async () => {
        debugGet(On, service);
        const data = await this.api.getDeviceData(this.deviceId, this.endpointId);
        const level = getTydomDataPropValue<number>(data, "level");
        const nextValue = level === 100;
        debugGetResult(On, service, nextValue);
        return nextValue;
      })
      .onSet(async (value) => {
        debugSet(On, service, value);
        const tydomValue = value ? 100 : 0;
        await this.api.putDeviceData(this.deviceId, this.endpointId, [
          { name: "level", value: tydomValue },
        ]);
        debugSetResult(On, service, value, tydomValue);
      });
  }

  update(updates: Record<string, unknown>[]): void {
    const { On } = this.platform.Characteristic;
    for (const { name, value } of updates) {
      if (name !== "level") {
        continue;
      }
      const nextValue = value === 100;
      debugSetUpdate(On, this.switchService, nextValue);
      this.switchService.updateCharacteristic(On, nextValue);
    }
  }
}

class SwitchAccessory extends SwitchableAccessory {
  protected get serviceClass(): ServiceClass {
    return this.platform.Service.Switch;
  }
}

class FanAccessory extends SwitchableAccessory {
  protected get serviceClass(): ServiceClass {
    return this.platform.Service.Fan;
  }
}

/** A light whose driver reports `level.step === 100`, so it has no brightness. */
class SwitchableLightbulbAccessory extends SwitchableAccessory {
  protected get serviceClass(): ServiceClass {
    return this.platform.Service.Lightbulb;
  }
}

export const createSwitchAccessory = (deps: AccessoryDeps): SwitchableAccessory =>
  new SwitchAccessory(deps);

export const createFanAccessory = (deps: AccessoryDeps): SwitchableAccessory =>
  new FanAccessory(deps);

export const createSwitchableLightbulbAccessory = (deps: AccessoryDeps): SwitchableAccessory =>
  new SwitchableLightbulbAccessory(deps);
