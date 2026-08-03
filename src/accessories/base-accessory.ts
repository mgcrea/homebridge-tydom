import type { PlatformAccessory, Service } from "homebridge";
import type { TydomApiClient } from "../api/client.js";
import type { TydomUpdateType } from "../api/types.js";
import type { ServiceClass } from "../helpers/accessory.js";
import type { TydomAccessoryContext } from "../typings/tydom.js";
import { debug } from "../platform/trace.js";
import type { AccessoryDeps, TydomAccessory } from "./base.js";

/**
 * Shared behaviour for the class-based accessories.
 *
 * Deliberately thin: it owns the accessory-information and identify wiring that
 * every accessory repeats, service lookup, and timer bookkeeping so `dispose`
 * can actually work. Everything device-specific stays in the subclass.
 */
export abstract class BaseAccessory implements TydomAccessory {
  protected readonly platform: AccessoryDeps["platform"];
  protected readonly accessory: PlatformAccessory<TydomAccessoryContext>;
  protected readonly api: TydomApiClient;
  protected readonly deviceId: number;
  protected readonly endpointId: number;

  #timers = new Set<NodeJS.Timeout>();
  #disposed = false;

  constructor(deps: AccessoryDeps) {
    this.platform = deps.platform;
    this.accessory = deps.accessory;
    this.api = deps.api;
    const { deviceId, endpointId } = deps.accessory.context;
    this.deviceId = deviceId;
    this.endpointId = endpointId;

    this.#setupInformation();
    this.#setupIdentify();
  }

  abstract update(updates: Record<string, unknown>[], type: TydomUpdateType): void | Promise<void>;

  /**
   * Release timers. Idempotent, and safe on an accessory whose constructor
   * never finished. Subclasses that hold their own state override this and call
   * `super.dispose()`.
   */
  dispose(): void {
    this.#disposed = true;
    for (const timer of this.#timers) {
      clearTimeout(timer);
    }
    this.#timers.clear();
  }

  protected get disposed(): boolean {
    return this.#disposed;
  }

  /** setTimeout that is cancelled by dispose(), unlike a bare one. */
  protected setTimer(handler: () => void, ms: number): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      handler();
    }, ms);
    timer.unref?.();
    this.#timers.add(timer);
    return timer;
  }

  protected clearTimer(timer: NodeJS.Timeout | undefined): void {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.#timers.delete(timer);
  }

  /**
   * Get-or-add a service.
   *
   * Never removes: the released helper took a `removeExisting` flag that every
   * caller passed `true`, so services were torn down and rebuilt on every
   * launch and HomeKit saw churn at each restart.
   */
  protected service(serviceClass: ServiceClass, name?: string): Service {
    const existing = this.accessory.getService(serviceClass);
    if (existing) {
      return existing;
    }
    // `addService` is overloaded on a union HAP does not let us satisfy
    // generically; the ServiceClass constraint already guarantees this is valid.
    // oxlint-disable-next-line typescript/no-explicit-any
    return this.accessory.addService(serviceClass as any, name ?? this.accessory.displayName);
  }

  /** Get-or-add a sub-service identified by subtype. */
  protected subService(serviceClass: ServiceClass, name: string, subtype: string): Service {
    return (
      this.accessory.getServiceById(serviceClass, subtype) ??
      this.accessory.addService(serviceClass, name, subtype)
    );
  }

  get name(): string {
    return this.accessory.displayName;
  }

  #setupInformation(): void {
    const { Characteristic, Service: ServiceStatics } = this.platform;
    const {
      manufacturer = "Delta Dore",
      serialNumber = "N/A",
      model = "N/A",
    } = this.accessory.context;

    const information = this.accessory.getService(ServiceStatics.AccessoryInformation);
    if (!information) {
      return;
    }
    information
      .setCharacteristic(Characteristic.Manufacturer, manufacturer)
      .setCharacteristic(Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(Characteristic.Model, model);
  }

  #setupIdentify(): void {
    this.accessory.on("identify", () => {
      debug(
        `New identify request for device named="${this.name}" with id="${this.accessory.UUID}"`,
      );
    });
  }
}
