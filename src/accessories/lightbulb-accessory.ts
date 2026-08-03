import { getTydomDataPropValue } from "../api/types.js";
import type { Service } from "homebridge";
import {
  debug,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
  debugTydomPut,
} from "../platform/trace.js";
import { WriteCoalescer } from "../util/coalesce.js";
import { EchoSuppressor } from "../util/echo.js";
import { styleString } from "../util/style.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/** Matches the debounce window the released implementation used. */
const WRITE_DELAY_MS = 15;

/**
 * A dimmable light.
 *
 * Drivers reporting `level.step === 100` cannot dim and resolve to
 * "lightbulb-switchable" during discovery, so this is always the dimmable case.
 */
export class LightbulbAccessory extends BaseAccessory {
  readonly #service: Service;
  readonly #writer: WriteCoalescer<number>;
  readonly #echo = new EchoSuppressor();

  /** Brightness to restore when switched on without a level. */
  #latestBrightness = 100;

  constructor(deps: AccessoryDeps) {
    super(deps);
    const { On, Brightness } = this.platform.Characteristic;
    this.#service = this.service(this.platform.Service.Lightbulb);

    this.#writer = new WriteCoalescer<number>({
      delayMs: WRITE_DELAY_MS,
      // Leading, so a tap lights the room immediately rather than after the
      // quiet period.
      leading: true,
      send: async (level) => {
        debugTydomPut("level", this.accessory, level);
        this.#echo.expect("level", level);
        await this.api.putDeviceData(this.deviceId, this.endpointId, [
          { name: "level", value: level },
        ]);
      },
      onError: (error) => {
        this.platform.log.error(`Failed to set level on ${this.name}: ${String(error)}`);
      },
    });

    this.#service
      .getCharacteristic(On)
      .onGet(async () => {
        debugGet(On, this.#service);
        const data = await this.api.getDeviceData(this.deviceId, this.endpointId);
        const level = getTydomDataPropValue<number>(data, "level");
        const nextValue = level > 0;
        debugGetResult(On, this.#service, nextValue);
        return nextValue;
      })
      .onSet((value) => {
        debugSet(On, this.#service, value);
        const nextLevel = value ? this.#latestBrightness || 100 : 0;
        this.#writer.submit(nextLevel);
        this.#service.updateCharacteristic(Brightness, nextLevel);
        debugSetResult(On, this.#service, value);
      });

    this.#service
      .getCharacteristic(Brightness)
      .onGet(async () => {
        debugGet(Brightness, this.#service);
        const data = await this.api.getDeviceData(this.deviceId, this.endpointId);
        const level = getTydomDataPropValue<number>(data, "level");
        debugGetResult(Brightness, this.#service, level);
        return level;
      })
      .onSet((value) => {
        debugSet(Brightness, this.#service, value);
        this.#latestBrightness = value as number;
        this.#writer.submit(value as number);
        debugSetResult(Brightness, this.#service, value);
      });
  }

  update(updates: Record<string, unknown>[]): void {
    const { On, Brightness } = this.platform.Characteristic;
    for (const { name, value } of updates) {
      if (name !== "level") {
        continue;
      }
      if (value === null || value === undefined) {
        debug(`Encountered a ${styleString("level")} update with a null value!`);
        continue;
      }
      const level = value as number;
      if (this.#echo.consume("level", level)) {
        debug(`Ignoring the echo of our own ${styleString("level")} write`);
        continue;
      }
      debugSetUpdate(On, this.#service, level > 0);
      this.#service.updateCharacteristic(On, level > 0);
      // Only track brightness for non-zero levels: HomeKit treats brightness 0
      // as off, and overwriting it would lose the restore value.
      if (level > 0) {
        this.#latestBrightness = level;
        debugSetUpdate(Brightness, this.#service, level);
        this.#service.updateCharacteristic(Brightness, level);
      }
    }
  }

  override dispose(): void {
    this.#writer.dispose();
    this.#echo.dispose();
    super.dispose();
  }
}

export const createLightbulbAccessory = (deps: AccessoryDeps): LightbulbAccessory =>
  new LightbulbAccessory(deps);
