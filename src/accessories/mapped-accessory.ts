import type {
  Characteristic,
  CharacteristicProps,
  CharacteristicValue,
  Service,
  WithUUID,
} from "homebridge";
import { getTydomDataPropValue } from "../api/types.js";
import {
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
} from "../platform/trace.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps, AccessoryFactory } from "./base.js";
import type { ServiceClass } from "./service-class.js";

/** A HAP characteristic constructor, as `getCharacteristic` wants it. */
export type CharacteristicClass = WithUUID<new () => Characteristic>;

/**
 * One HomeKit characteristic's link to one Tydom property.
 *
 * The mapping is declared once and used by both directions. That is the point:
 * the read path and the push path each used to carry their own copy, and they
 * had already drifted — the smoke detector wrote a raw boolean into
 * `StatusLowBattery` on a push while its `onGet` mapped the same flag onto HAP's
 * LOW/NORMAL constants. It happened to work because `true` coerces to `1`.
 */
export type PropBinding = {
  characteristic: CharacteristicClass;
  /** The Tydom property this characteristic reads. */
  prop: string;
  /** Tydom value to HomeKit value. Identity when omitted. */
  toHomeKit?: (value: never) => CharacteristicValue;
  /** HomeKit value to Tydom value. Omit for a read-only characteristic. */
  toTydom?: (value: CharacteristicValue) => unknown;
  /** Narrowed or widened HAP metadata, applied before the handlers. */
  props?: Partial<CharacteristicProps>;
  /**
   * Further Tydom properties that also move this characteristic on a push, each
   * with its own mapping. A read still uses `prop` alone — these are properties
   * the gateway volunteers, not ones worth querying.
   */
  alsoUpdatedBy?: Record<string, (value: never) => CharacteristicValue>;
};

/**
 * A device whose whole behaviour is "these characteristics read these
 * properties".
 *
 * Everything the simple accessories used to spell out by hand — the trace call
 * before and after each read, the `getTydomDataPropValue` lookup, the
 * `for (const {name, value} of updates) if (name !== "…") continue` push loop —
 * happens here once. What is left in a device's own file is the part that is
 * actually different between one device and the next.
 *
 * Devices with real logic (the thermostat's HVAC mapping, the garage door's
 * simulated travel, the alarm's two arming protocols) keep their own classes:
 * they are long because of what they do, not because of what they repeat.
 */
export class MappedAccessory extends BaseAccessory {
  readonly #service: Service;
  readonly #bindings: PropBinding[];

  constructor(deps: AccessoryDeps, spec: AccessorySpec) {
    super(deps);
    this.#service = this.service(spec.service(this.platform.Service));
    this.#bindings = spec.bindings(this.platform.Characteristic);
    for (const binding of this.#bindings) {
      this.#bind(binding);
    }
  }

  /** The service this accessory publishes. Exposed for tests. */
  get publishedService(): Service {
    return this.#service;
  }

  #bind(binding: PropBinding): void {
    const { characteristic, prop, toHomeKit, toTydom, props } = binding;
    const service = this.#service;
    const target = service.getCharacteristic(characteristic);

    if (props) {
      target.setProps(props);
    }

    target.onGet(async () => {
      debugGet(characteristic, service);
      const data = await this.read();
      const raw = getTydomDataPropValue(data, prop);
      const value = toHomeKit ? toHomeKit(raw as never) : (raw as CharacteristicValue);
      debugGetResult(characteristic, service, value);
      return value;
    });

    if (!toTydom) {
      return;
    }
    target.onSet(async (value) => {
      debugSet(characteristic, service, value);
      const tydomValue = toTydom(value);
      await this.api.putDeviceData(this.deviceId, this.endpointId, [
        { name: prop, value: tydomValue },
      ]);
      debugSetResult(characteristic, service, value, tydomValue);
    });
  }

  /**
   * The mapping a pushed property feeds, or undefined if this binding ignores
   * it. Read and push therefore agree by construction.
   */
  #mapperFor(
    binding: PropBinding,
    name: string,
  ): ((value: never) => CharacteristicValue) | undefined {
    if (name === binding.prop) {
      return binding.toHomeKit ?? ((value: never) => value as CharacteristicValue);
    }
    return binding.alsoUpdatedBy?.[name];
  }

  protected override apply(updates: Record<string, unknown>[]): void {
    for (const { name, value } of updates) {
      for (const binding of this.#bindings) {
        const map = this.#mapperFor(binding, name as string);
        if (!map) {
          continue;
        }
        const next = map(value as never);
        debugSetUpdate(binding.characteristic, this.#service, next);
        this.#service.updateCharacteristic(binding.characteristic, next);
      }
    }
  }
}

/**
 * A device type declared as data.
 *
 * Both halves are functions of the HAP statics rather than values, because
 * those arrive on the platform instance — there is no module-level HAP to read
 * at import time, which is exactly what keeps this testable.
 */
export type AccessorySpec = {
  service: (services: typeof Service) => ServiceClass;
  bindings: (characteristics: typeof Characteristic) => PropBinding[];
};

/** Turn a spec into the factory the registry expects. */
export const mappedAccessory =
  (spec: AccessorySpec): AccessoryFactory =>
  (deps: AccessoryDeps) =>
    new MappedAccessory(deps, spec);
