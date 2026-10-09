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
  /** How long after switching on to switch off again, if the user asked. */
  readonly #autoShutdownMs: number | undefined;
  /** The writable `On` binding, which is the only thing there is to switch off. */
  readonly #onBinding: PropBinding | undefined;
  #autoShutdownTimer: NodeJS.Timeout | undefined;
  /**
   * What the `On` characteristic last read, so a repeat can be told from a
   * change. The periodic refresh pushes the current state whether or not it
   * moved, and re-arming on those would push the shutdown out for as long as
   * the device stayed on — which is the one thing it must not do.
   */
  #isOn: boolean | undefined;

  constructor(deps: AccessoryDeps, spec: AccessorySpec) {
    super(deps);
    this.#service = this.service(spec.service(this.platform.Service));
    this.#bindings = spec.bindings(this.platform.Characteristic);

    const { autoShutdownDelay } = (this.accessory.context.settings ?? {}) as AutoShutdownSettings;
    this.#autoShutdownMs = autoShutdownDelay;
    const { On } = this.platform.Characteristic;
    this.#onBinding = this.#bindings.find(
      (binding) => binding.characteristic === On && binding.toTydom,
    );

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
      this.#trackAutoShutdown(binding, value);
    });
  }

  /**
   * Arm or stand down the auto-shutdown, following the device's on state.
   *
   * Called from both directions on purpose: the Home app is the case nobody
   * needs help with, and a switch left on at the wall is the case the setting
   * exists for.
   */
  #trackAutoShutdown(binding: PropBinding, value: CharacteristicValue): void {
    if (this.#autoShutdownMs === undefined || binding !== this.#onBinding) {
      return;
    }
    const isOn = value === true;
    if (isOn === this.#isOn) {
      return;
    }
    this.#isOn = isOn;
    this.clearTimer(this.#autoShutdownTimer);
    this.#autoShutdownTimer = undefined;
    if (!isOn) {
      return;
    }
    this.#autoShutdownTimer = this.setTimer(() => {
      this.#autoShutdownTimer = undefined;
      void this.#switchOff(binding);
    }, this.#autoShutdownMs);
  }

  async #switchOff(binding: PropBinding): Promise<void> {
    const { On } = this.platform.Characteristic;
    this.#isOn = false;
    try {
      await this.api.putDeviceData(this.deviceId, this.endpointId, [
        { name: binding.prop, value: binding.toTydom?.(false) },
      ]);
    } catch (err) {
      this.platform.log.error(
        `Failed to switch off ${this.accessory.displayName} after its shutdown delay: ${String(err)}`,
      );
      return;
    }
    debugSetUpdate(On, this.#service, false);
    this.#service.updateCharacteristic(On, false);
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
        this.#trackAutoShutdown(binding, next);
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
/** Per-device settings this accessory reads. */
type AutoShutdownSettings = { autoShutdownDelay?: number };

export type AccessorySpec = {
  service: (services: typeof Service) => ServiceClass;
  bindings: (characteristics: typeof Characteristic) => PropBinding[];
};

/** Turn a spec into the factory the registry expects. */
export const mappedAccessory =
  (spec: AccessorySpec): AccessoryFactory =>
  (deps: AccessoryDeps) =>
    new MappedAccessory(deps, spec);
