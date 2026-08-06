/**
 * An in-memory stand-in for the HAP objects an accessory talks to.
 *
 * The accessory layer is the one part of this plugin that legitimately needs
 * HAP, which is why it went untested for so long: `@homebridge/hap-nodejs` is a
 * transitive dependency of `homebridge` and pnpm does not expose it, and adding
 * it outright would pin the tests to one HAP version to gain very little. What
 * the accessories actually use is a small surface — get-or-add a service, get a
 * characteristic, set props, register `onGet`/`onSet`, push a value — so that is
 * what this implements.
 *
 * The one risk with a hand-built double is passing vacuously: a spec reading
 * `Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW` off a stub that does not
 * define it gets `undefined`, and an assertion against `undefined` succeeds
 * while the real bridge reports the wrong battery state. So constant-shaped
 * statics throw unless they are seeded below with their real HAP values.
 */

import type { Characteristic, Service } from "homebridge";

/** Real HAP values for the constants the accessories read. */
const CHARACTERISTIC_CONSTANTS: Record<string, Record<string, number>> = {
  StatusLowBattery: { BATTERY_LEVEL_NORMAL: 0, BATTERY_LEVEL_LOW: 1 },
  ContactSensorState: { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 },
  SmokeDetected: { SMOKE_NOT_DETECTED: 0, SMOKE_DETECTED: 1 },
};

/** Looks like a HAP enum constant, as opposed to `name` or `prototype`. */
const isConstantName = (prop: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(prop);

/** A stub HAP class: identity-comparable, named, and strict about constants. */
const makeHapClass = (kind: string, className: string): { name: string } => {
  const constants = CHARACTERISTIC_CONSTANTS[className] ?? {};
  const target = { name: className, UUID: `${kind}:${className}`, ...constants };
  return new Proxy(target, {
    get(object, prop) {
      if (typeof prop === "string" && !(prop in object) && isConstantName(prop)) {
        throw new Error(
          `${kind}.${className}.${prop} is not seeded in the HAP double. Add its real HAP ` +
            `value to CHARACTERISTIC_CONSTANTS — reading it as undefined would let a wrong ` +
            `mapping pass.`,
        );
      }
      return Reflect.get(object, prop) as unknown;
    },
  }) as { name: string };
};

/** Mints a stable stub per name, so `Service.Outlet === Service.Outlet`. */
const makeStatics = (kind: string) => {
  const cache: Record<string, { name: string }> = {};
  return new Proxy(cache, {
    get(object, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      object[prop] ??= makeHapClass(kind, prop);
      return object[prop];
    },
  });
};

export type HapClass = { name: string };

export class FakeCharacteristic {
  value: unknown;
  props: Record<string, unknown> = {};
  #get: (() => unknown) | undefined;
  #set: ((value: unknown) => unknown) | undefined;

  constructor(readonly name: string) {}

  setProps(props: Record<string, unknown>): this {
    Object.assign(this.props, props);
    return this;
  }

  onGet(handler: () => unknown): this {
    this.#get = handler;
    return this;
  }

  onSet(handler: (value: unknown) => unknown): this {
    this.#set = handler;
    return this;
  }

  updateValue(value: unknown): this {
    this.value = value;
    return this;
  }

  get readable(): boolean {
    return Boolean(this.#get);
  }

  get writable(): boolean {
    return Boolean(this.#set);
  }

  /** Drive a HomeKit read, as the bridge would. */
  async handleGet(): Promise<unknown> {
    if (!this.#get) {
      throw new Error(`Characteristic ${this.name} has no onGet handler`);
    }
    this.value = await this.#get();
    return this.value;
  }

  /** Drive a HomeKit write, as the bridge would. */
  async handleSet(value: unknown): Promise<void> {
    if (!this.#set) {
      throw new Error(`Characteristic ${this.name} has no onSet handler`);
    }
    await this.#set(value);
  }
}

export class FakeService {
  readonly characteristics = new Map<string, FakeCharacteristic>();

  constructor(
    public displayName: string,
    readonly serviceName: string,
    readonly subtype?: string,
  ) {}

  getCharacteristic(hapClass: HapClass): FakeCharacteristic {
    let characteristic = this.characteristics.get(hapClass.name);
    if (!characteristic) {
      characteristic = new FakeCharacteristic(hapClass.name);
      this.characteristics.set(hapClass.name, characteristic);
    }
    return characteristic;
  }

  setCharacteristic(hapClass: HapClass, value: unknown): this {
    this.getCharacteristic(hapClass).value = value;
    return this;
  }

  updateCharacteristic(hapClass: HapClass, value: unknown): this {
    this.getCharacteristic(hapClass).value = value;
    return this;
  }

  addOptionalCharacteristic(): void {}

  /** The value HomeKit currently holds, without invoking the read handler. */
  currentValue(hapClass: HapClass): unknown {
    return this.characteristics.get(hapClass.name)?.value;
  }
}

export class FakeAccessory {
  readonly services: FakeService[] = [];
  readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  context: Record<string, unknown> = {};

  constructor(
    public displayName: string,
    public UUID: string,
  ) {
    // A real PlatformAccessory always carries this one.
    this.services.push(new FakeService(displayName, "AccessoryInformation"));
  }

  getService(hapClass: HapClass): FakeService | undefined {
    return this.services.find(
      (service) => service.serviceName === hapClass.name && !service.subtype,
    );
  }

  getServiceById(hapClass: HapClass, subtype: string): FakeService | undefined {
    return this.services.find(
      (service) => service.serviceName === hapClass.name && service.subtype === subtype,
    );
  }

  addService(hapClass: HapClass, name: string, subtype?: string): FakeService {
    const service = new FakeService(name, hapClass.name, subtype);
    this.services.push(service);
    return service;
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler);
    this.listeners.set(event, set);
    return this;
  }

  removeListener(event: string, handler: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/**
 * The HAP statics an accessory reaches through `platform.Service` /
 * `.Characteristic`.
 *
 * Cast to the real HAP types rather than left as an index signature: it is what
 * the accessories are handed, and it means a test naming a characteristic that
 * does not exist fails to compile instead of quietly minting a stub for it.
 */
export const createHapStatics = () => ({
  Service: makeStatics("Service") as unknown as typeof Service,
  Characteristic: makeStatics("Characteristic") as unknown as typeof Characteristic,
});
