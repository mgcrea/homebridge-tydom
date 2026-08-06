import type { PlatformAccessory, Service } from "homebridge";
import type { TydomApiClient } from "../api/client.js";
import type { TydomDataElement, TydomEndpointData, TydomUpdateType } from "../api/types.js";
import { StateCache } from "../util/state-cache.js";
import type { ServiceClass } from "./service-class.js";
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
  protected readonly notify: AccessoryDeps["notify"];
  /** Delta Dore label lookups, bound to the configured locale. */
  protected readonly t: AccessoryDeps["t"];

  /**
   * Resolves once asynchronous setup has finished.
   *
   * Accessories that need a round trip before their services exist assign this,
   * and queue inbound pushes behind it — the gateway can and does push before
   * setup completes.
   */
  protected ready: Promise<void> = Promise.resolve();

  #timers = new Set<NodeJS.Timeout>();
  #disposed = false;
  readonly #state: StateCache<TydomDataElement>;
  /** Held so `dispose` can detach it; see `#setupIdentify`. */
  #identifyListener: (() => void) | undefined;

  constructor(deps: AccessoryDeps) {
    this.platform = deps.platform;
    this.accessory = deps.accessory;
    this.api = deps.api;
    this.notify = deps.notify;
    this.t = deps.t;
    const { deviceId, endpointId } = deps.accessory.context;
    this.deviceId = deviceId;
    this.endpointId = endpointId;

    this.#state = new StateCache<TydomDataElement>({
      fetch: async () => this.api.getDeviceData(this.deviceId, this.endpointId),
      staleAfterMs: this.platform.config.staleAfterMs,
      // A repair is fed back through the accessory's own push handler: a
      // refresh is exactly a push of every property at once, and `apply` is
      // already the code that knows how to put those onto characteristics.
      onRepair: (data) => {
        void this.apply(data, "data");
      },
      onError: (err) => {
        debug(`Failed to refresh ${this.name}: ${String(err)}`);
      },
    });

    this.#setupInformation();
    this.#setupIdentify();
  }

  /**
   * Apply a push from the gateway. Implemented by every accessory.
   *
   * Must be idempotent for `type: "data"` — the lazy repair replays a full
   * snapshot through it. `type: "cdata"` carries events, which are not
   * replayed and may have side effects such as raising a notification.
   */
  protected abstract apply(
    updates: Record<string, unknown>[],
    type: TydomUpdateType,
  ): void | Promise<void>;

  /**
   * Entry point for the platform. Not overridden: it keeps the local state in
   * step with what the gateway has told us before handing off to `apply`.
   */
  update(updates: Record<string, unknown>[], type: TydomUpdateType): void | Promise<void> {
    if (type === "data") {
      this.#state.merge(updates as TydomDataElement[]);
    }
    return this.apply(updates, type);
  }

  /**
   * The endpoint's data, for a characteristic read.
   *
   * Served from memory once warm. The first read blocks, as every read used to;
   * a read that finds the data stale returns it anyway and repairs in the
   * background. See `StateCache` for why that is the right trade here.
   */
  protected async read<T extends TydomEndpointData = TydomEndpointData>(): Promise<T> {
    return (await this.#state.read()) as T;
  }

  /**
   * Release timers. Idempotent, and safe on an accessory whose constructor
   * never finished. Subclasses that hold their own state override this and call
   * `super.dispose()`.
   */
  dispose(): void {
    this.#disposed = true;
    this.#state.dispose();
    for (const timer of this.#timers) {
      clearTimeout(timer);
    }
    this.#timers.clear();
    if (this.#identifyListener) {
      this.accessory.removeListener("identify", this.#identifyListener);
      this.#identifyListener = undefined;
    }
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

  /**
   * Get-or-add a sub-service identified by subtype.
   *
   * Carries `ConfiguredName` alongside the `Name` that `addService` sets. Which
   * of the two the Home app actually renders is not something we could pin
   * down: hap-nodejs declares `ConfiguredName` for AccessoryInformation,
   * InputSource, SmartSpeaker, Television and WiFiRouter only, which suggests
   * it is ignored on a Switch — but sub-service captions do render, and no
   * experiment separated the two cheaply. It stays because removing it risks
   * the labels, and it costs one characteristic.
   *
   * Note that captions appear only when the Home app is showing the accessory
   * as separate tiles. Merged into a single tile it captions nothing, and that
   * is the user's setting, not ours.
   *
   * Filled in only when empty, which covers both a new service and one cached
   * by a release that never set it — but leaves a name the user typed in the
   * Home app alone, since their rename is stored in this same characteristic.
   */
  protected subService(serviceClass: ServiceClass, name: string, subtype: string): Service {
    const { ConfiguredName } = this.platform.Characteristic;
    const service =
      this.accessory.getServiceById(serviceClass, subtype) ??
      this.accessory.addService(serviceClass, name, subtype);
    service.addOptionalCharacteristic(ConfiguredName);
    if (!service.getCharacteristic(ConfiguredName).value) {
      service.setCharacteristic(ConfiguredName, name);
    }
    return service;
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

  /**
   * Log HomeKit's "identify this accessory" request.
   *
   * The listener is kept so `dispose` can remove it. A `PlatformAccessory`
   * outlives the handler wrapping it — `configureHandler` disposes the old
   * handler and builds a new one against the same accessory whenever a device's
   * category changes — so a listener left attached accumulates one copy per
   * rebuild, each holding its dead handler alive.
   */
  #setupIdentify(): void {
    this.#identifyListener = () => {
      debug(
        `New identify request for device named="${this.name}" with id="${this.accessory.UUID}"`,
      );
    };
    this.accessory.on("identify", this.#identifyListener);
  }
}
