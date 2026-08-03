import { getTydomDataPropValue } from "../api/types.js";
import type { Service } from "homebridge";
import type { TydomUpdateType } from "../api/types.js";
import type { TydomDeviceShutterData } from "../typings/tydom.js";
import {
  debug,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
  debugTydomPut,
} from "../platform/trace.js";
import { asNumber } from "../util/basic.js";
import { WriteCoalescer } from "../util/coalesce.js";
import { EchoSuppressor } from "../util/echo.js";
import { styleJson, styleKeyword, styleString } from "../util/style.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/** Matches the debounce window the released implementation used. */
const WRITE_DELAY_MS = 250;

/** A roller shutter or awning. */
export class WindowCoveringAccessory extends BaseAccessory {
  readonly #service: Service;
  readonly #writer: WriteCoalescer<number>;
  readonly #echo = new EchoSuppressor();

  constructor(deps: AccessoryDeps) {
    super(deps);
    const { CurrentPosition, TargetPosition, PositionState, HoldPosition } =
      this.platform.Characteristic;
    this.#service = this.service(this.platform.Service.WindowCovering);

    this.#writer = new WriteCoalescer<number>({
      delayMs: WRITE_DELAY_MS,
      // Leading, so a tap starts the shutter moving straight away. Dropping it
      // would add a quarter second to every gesture on hardware the user is
      // watching move.
      leading: true,
      send: async (position) => {
        debugTydomPut("position", this.accessory, position);
        this.#echo.expect("position", position);
        await this.api.putDeviceData(this.deviceId, this.endpointId, [
          { name: "position", value: position },
        ]);
      },
      onError: (error) => {
        this.platform.log.error(`Failed to set position on ${this.name}: ${String(error)}`);
      },
    });

    this.#service.getCharacteristic(PositionState).onGet(() => {
      debugGet(PositionState, this.#service);
      // The gateway does not report travel direction, only a position.
      const nextValue = PositionState.STOPPED;
      debugGetResult(PositionState, this.#service, nextValue);
      return nextValue;
    });

    this.#service.getCharacteristic(HoldPosition).onSet(async (value) => {
      debugSet(HoldPosition, this.#service, value);
      if (!value) {
        return;
      }
      // Stop overrides anything buffered — the user wants it to halt now, not
      // to finish travelling to a position they have abandoned.
      this.#writer.dispose();
      debugTydomPut("positionCmd", this.accessory, "STOP");
      await this.api.putDeviceData(this.deviceId, this.endpointId, [
        { name: "positionCmd", value: "STOP" },
      ]);
      debugSetResult(HoldPosition, this.#service, value, "STOP");
    });

    this.#service.getCharacteristic(CurrentPosition).onGet(async () => {
      debugGet(CurrentPosition, this.#service);
      const nextValue = await this.#readPosition();
      debugGetResult(CurrentPosition, this.#service, nextValue);
      return nextValue;
    });

    this.#service
      .getCharacteristic(TargetPosition)
      .onGet(async () => {
        debugGet(TargetPosition, this.#service);
        const nextValue = await this.#readPosition();
        debugGetResult(TargetPosition, this.#service, nextValue);
        return nextValue;
      })
      .onSet((value) => {
        debugSet(TargetPosition, this.#service, value);
        this.#writer.submit(value as number);
        debugSetResult(TargetPosition, this.#service, value);
      });
  }

  protected override apply(updates: Record<string, unknown>[], type: TydomUpdateType): void {
    const { CurrentPosition, TargetPosition, ObstructionDetected } = this.platform.Characteristic;

    if (type === "cdata") {
      for (const update of updates) {
        const { event } = update as { event?: unknown };
        debug(`New ${styleKeyword("WindowCovering")} event=${styleJson(event)}`);
      }
      return;
    }

    for (const { name, value } of updates) {
      switch (name) {
        case "position": {
          if (value === null || value === undefined) {
            debug(`Encountered a ${styleString("position")} update with a null value!`);
            break;
          }
          const position = asNumber(value);
          // CurrentPosition always tracks the device, including our own writes:
          // it is where the shutter actually is.
          debugSetUpdate(CurrentPosition, this.#service, position);
          this.#service.updateCharacteristic(CurrentPosition, position);
          // TargetPosition must not, or the echo of a write fights the next
          // drag the user makes.
          if (this.#echo.consume("position", position)) {
            debug(`Ignoring the echo of our own ${styleString("position")} write`);
            break;
          }
          debugSetUpdate(TargetPosition, this.#service, position);
          this.#service.updateCharacteristic(TargetPosition, position);
          break;
        }
        case "obstacleDefect": {
          debugSetUpdate(ObstructionDetected, this.#service, value);
          this.#service.updateCharacteristic(ObstructionDetected, value as boolean);
          break;
        }
        default:
          break;
      }
    }
  }

  override dispose(): void {
    this.#writer.dispose();
    this.#echo.dispose();
    super.dispose();
  }

  async #readPosition(): Promise<number> {
    const data = await this.read<TydomDeviceShutterData>();
    return asNumber(getTydomDataPropValue<number>(data, "position") || 0);
  }
}

export const createWindowCoveringAccessory = (deps: AccessoryDeps): WindowCoveringAccessory =>
  new WindowCoveringAccessory(deps);
