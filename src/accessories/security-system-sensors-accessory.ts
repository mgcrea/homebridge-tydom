import type { Service } from "homebridge";
import get from "lodash/get.js";
import type { TydomUpdateType } from "../api/types.js";
import locale from "../config/locale.js";
import { debugAddSubService, debugGet, debugGetResult, debugSetUpdate } from "../platform/trace.js";
import type {
  SecuritySystemHistoOpenIssuesCommandResult,
  SecuritySystemLabelCommandResult,
  SecuritySystemProduct,
} from "../typings/tydom.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/**
 * The alarm's opening detectors, published as a companion accessory.
 *
 * A separate accessory rather than more sub-services on the panel, because
 * HomeKit shows an alarm's linked services inside its tile and a dozen door
 * contacts there is unusable.
 *
 * The released version kept `contactSensorProducts` and `histoSearchParams` at
 * module scope, so a second alarm overwrote the first one's detector list and
 * both accessories then reported against the wrong panel. Both are instance
 * state here.
 */
export class SecuritySystemSensorsAccessory extends BaseAccessory {
  #products: SecuritySystemProduct[] = [];
  #histoParams: Record<string, string> = {};
  /** Contact sensors, by the detector product id they track. */
  readonly #sensors = new Map<number, Service>();

  /** Kick off setup and expose it as the readiness gate. */
  start(): void {
    this.ready = this.setup().catch((err: unknown) => {
      this.platform.log.error(`Failed to set up ${this.name}: ${String(err)}`);
    });
  }

  async setup(): Promise<void> {
    const { Characteristic, Service: Services } = this.platform;
    const { ContactSensorState } = Characteristic;

    const labels = await this.api.runCommand<SecuritySystemLabelCommandResult>(
      this.deviceId,
      this.endpointId,
      "label",
    );
    const products = labels[0]?.products ?? [];
    this.#products = products.filter((product) => product.typeLong === "MDO");
    this.#histoParams = {
      type: "OPEN_ISSUES",
      indexStart: "0",
      nbElem: `${this.#products.length}`,
    };

    const openIssues = await this.#readOpenIssues();

    for (const product of this.#products) {
      const { id: productId, nameStd, nameCustom, number } = product;
      const name =
        nameCustom ?? `${get(locale, nameStd, "N/A") as string}${number ? ` ${number}` : ""}`;
      const service = this.subService(Services.ContactSensor, name, `systOpenIssue_${productId}`);
      debugAddSubService(service, this.accessory);
      this.#sensors.set(productId, service);

      service
        .getCharacteristic(ContactSensorState)
        .setValue(openIssues.has(productId) ? 1 : 0)
        .onGet(async () => {
          debugGet(ContactSensorState, service);
          const issues = await this.#readOpenIssues();
          const nextValue = issues.has(productId) ? 1 : 0;
          debugGetResult(ContactSensorState, service, nextValue);
          return nextValue;
        });
      service.getCharacteristic(Characteristic.StatusActive).setValue(1);
      service.getCharacteristic(Characteristic.StatusFault).setValue(0);
    }
  }

  update(updates: Record<string, unknown>[], type: TydomUpdateType): void {
    if (type === "cdata") {
      return;
    }
    // Services may not exist yet: setup needs two round trips.
    void this.ready.then(async () => {
      for (const { name, value } of updates) {
        if (name !== "systOpenIssue") {
          continue;
        }
        // The panel reports only that *something* is open, not which detector,
        // so a re-read is the only way to find out. When it clears, every
        // sensor closes and no round trip is needed.
        const issues = value ? await this.#readOpenIssues() : new Set<number>();
        this.#applyOpenIssues(issues);
      }
      return undefined;
    });
  }

  override dispose(): void {
    this.#sensors.clear();
    super.dispose();
  }

  #applyOpenIssues(openIssues: Set<number>): void {
    const { ContactSensorState } = this.platform.Characteristic;
    for (const [productId, service] of this.#sensors) {
      const nextValue = openIssues.has(productId) ? 1 : 0;
      debugSetUpdate(ContactSensorState, service, nextValue);
      service.updateCharacteristic(ContactSensorState, nextValue);
    }
  }

  /** The detector ids currently reporting an open issue. */
  async #readOpenIssues(): Promise<Set<number>> {
    const results = await this.api.runCommand<SecuritySystemHistoOpenIssuesCommandResult>(
      this.deviceId,
      this.endpointId,
      "histo",
      this.#histoParams,
    );
    const open = new Set<number>();
    for (const result of results) {
      if (result.product) {
        open.add(result.product.id);
      }
    }
    return open;
  }
}

export const createSecuritySystemSensorsAccessory = (
  deps: AccessoryDeps,
): SecuritySystemSensorsAccessory => {
  const accessory = new SecuritySystemSensorsAccessory(deps);
  accessory.start();
  return accessory;
};
