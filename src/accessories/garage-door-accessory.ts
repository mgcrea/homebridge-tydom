import type { Service } from "homebridge";
import type { TydomUpdateType } from "../api/types.js";
import { getTydomDataPropValue } from "../helpers/tydom.js";
import type { TydomDeviceGarageDoorData } from "../typings/tydom.js";
import { debug, debugGet, debugGetResult, debugSet, debugSetResult } from "../platform/trace.js";
import { asNumber } from "../util/basic.js";
import { styleJson, styleKeyword, styleNumber, styleString } from "../util/style.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";

/** How long the door takes to travel end to end, unless configured otherwise. */
const DEFAULT_TRAVEL_MS = 20 * 1000;
/** Pause before reversing course out of a STOPPED state. */
const REVERSE_PAUSE_MS = 1000;

type GarageDoorSettings = {
  delay?: number;
  autoCloseDelay?: number;
};

/**
 * A gate or garage door.
 *
 * The gateway reports only `level` 0 or 100 and never reports travel, so
 * OPENING and CLOSING are simulated on a timer sized by `settings.delay`. All of
 * that timer work used to run through a module-global map in util/basic.ts,
 * keyed on the bare literal "stopping" for the reverse pause — so two garage
 * doors in one home cancelled each other's transitions. Timers are per-instance
 * here, and released on dispose.
 */
export class GarageDoorAccessory extends BaseAccessory {
  readonly #service: Service;
  readonly #travelMs: number;
  readonly #autoCloseMs: number | undefined;
  /** Some drivers expose only TOGGLE and cannot be commanded to a state. */
  readonly #toggleOnly: boolean;

  #currentDoorState: number;
  #lastUpdatedAt = 0;
  #computedPosition = 0;
  #transition: NodeJS.Timeout | undefined;

  constructor(deps: AccessoryDeps) {
    super(deps);
    const { CurrentDoorState, TargetDoorState } = this.platform.Characteristic;
    const { settings, metadata } = this.accessory.context;
    const { delay = DEFAULT_TRAVEL_MS, autoCloseDelay } = settings as GarageDoorSettings;

    this.#travelMs = delay;
    this.#autoCloseMs = autoCloseDelay;
    const levelCmdValues = metadata.find((m) => m.name === "levelCmd")?.enum_values;
    this.#toggleOnly = levelCmdValues?.length === 1 && levelCmdValues[0] === "TOGGLE";
    this.#currentDoorState = CurrentDoorState.CLOSED;

    // Older releases published this device as a Switch; drop it so the tile does
    // not linger alongside the door.
    const legacy = this.accessory.getService(this.platform.Service.Switch);
    if (legacy) {
      this.accessory.removeService(legacy);
    }
    this.#service = this.service(this.platform.Service.GarageDoorOpener);

    this.#service.getCharacteristic(CurrentDoorState).onGet(async () => {
      debugGet(CurrentDoorState, this.#service);
      if (this.#toggleOnly) {
        debugGetResult(CurrentDoorState, this.#service, this.#currentDoorState);
        return this.#currentDoorState;
      }
      const next = await this.#readDoorState();
      this.#applyKnownState(next);
      debugGetResult(CurrentDoorState, this.#service, next);
      return next;
    });

    this.#service
      .getCharacteristic(TargetDoorState)
      .onGet(async () => {
        debugGet(TargetDoorState, this.#service);
        if (this.#toggleOnly) {
          debugGetResult(TargetDoorState, this.#service, this.#currentDoorState);
          return this.#currentDoorState;
        }
        const next = await this.#readDoorState();
        this.#lastUpdatedAt = Date.now();
        this.#computedPosition = next === TargetDoorState.OPEN ? 100 : 0;
        debugGetResult(TargetDoorState, this.#service, next);
        return next;
      })
      .onSet(async (value) => {
        debugSet(TargetDoorState, this.#service, value);
        await this.#requestDoorState(asNumber(value));
        debugSetResult(TargetDoorState, this.#service, value);
      });
  }

  update(updates: Record<string, unknown>[], type: TydomUpdateType): void {
    const { CurrentDoorState, TargetDoorState } = this.platform.Characteristic;

    if (type === "cdata") {
      for (const update of updates) {
        const { event } = update as { event?: unknown };
        debug(`New ${styleKeyword("GarageDoorOpener")} event=${styleJson(event)}`);
      }
      return;
    }

    for (const { name, value } of updates) {
      if (name !== "level") {
        continue;
      }
      const level = asNumber(value);
      if (level > 0 && level < 100) {
        debug(`Encountered a ${styleString("level")} update with value different from 0 or 100 !`);
        continue;
      }
      const doorState = level === 100 ? CurrentDoorState.OPEN : CurrentDoorState.CLOSED;

      // The device has told us where it actually is, so the simulated
      // transition is now wrong — drop it rather than let it fire later and
      // overwrite this with a guess.
      //
      // The released version logged "ignoring update" here when the door was
      // OPENING or CLOSING, but had no `return`, so it applied the update
      // anyway while leaving the timer running. Applying is the right call;
      // it was the timer that needed cancelling.
      if (
        this.#currentDoorState === CurrentDoorState.OPENING ||
        this.#currentDoorState === CurrentDoorState.CLOSING
      ) {
        debug(
          `Door reported ${styleString(this.#label(doorState))}; cancelling the simulated travel`,
        );
        this.#cancelTransition();
      }

      debugSetResult(CurrentDoorState, this.#service, doorState);
      this.#service.updateCharacteristic(CurrentDoorState, doorState);
      debugSetResult(TargetDoorState, this.#service, doorState);
      this.#service.updateCharacteristic(TargetDoorState, doorState);
      this.#applyKnownState(doorState);
    }
  }

  override dispose(): void {
    this.#cancelTransition();
    super.dispose();
  }

  async #requestDoorState(targetDoorState: number): Promise<void> {
    const { CurrentDoorState } = this.platform.Characteristic;

    this.#lastUpdatedAt = Date.now();
    this.#computedPosition = this.#positionNow();

    let next = this.#nextDoorState(targetDoorState);
    if (next === this.#currentDoorState) {
      debug(`nextCurrentDoorState=${styleNumber(next)} === currentDoorState, nothing to do`);
      return;
    }

    await this.#sendCommand(targetDoorState);
    this.#setDoorState(next);

    // A door interrupted mid-travel lands in STOPPED; pause, then command it
    // again to reverse course.
    if (next === CurrentDoorState.STOPPED) {
      await this.#pause(REVERSE_PAUSE_MS);
      if (this.disposed) {
        return;
      }
      this.#lastUpdatedAt = Date.now();
      this.#computedPosition = this.#positionNow();
      next = this.#nextDoorState(targetDoorState);
      await this.#sendCommand(targetDoorState);
      this.#setDoorState(next);
    }

    this.#scheduleArrival(next);
  }

  /** Simulate the travel the gateway does not report. */
  #scheduleArrival(state: number): void {
    const { CurrentDoorState } = this.platform.Characteristic;
    this.#cancelTransition();

    if (state === CurrentDoorState.OPENING) {
      const delay = ((100 - this.#computedPosition) * this.#travelMs) / 100;
      debug(`Scheduling OPEN in ${styleNumber(delay)}ms`);
      this.#transition = this.setTimer(() => {
        this.#transition = undefined;
        this.#setDoorState(CurrentDoorState.OPEN);
        if (this.#autoCloseMs) {
          this.#transition = this.setTimer(() => {
            this.#transition = undefined;
            this.#setDoorState(CurrentDoorState.CLOSED);
          }, this.#autoCloseMs);
        }
      }, delay);
      return;
    }

    if (state === CurrentDoorState.CLOSING) {
      const delay = (this.#computedPosition * this.#travelMs) / 100;
      debug(`Scheduling CLOSED in ${styleNumber(delay)}ms`);
      this.#transition = this.setTimer(() => {
        this.#transition = undefined;
        this.#setDoorState(CurrentDoorState.CLOSED);
      }, delay);
    }
  }

  #cancelTransition(): void {
    this.clearTimer(this.#transition);
    this.#transition = undefined;
  }

  async #pause(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.setTimer(resolve, ms);
    });
  }

  async #sendCommand(targetDoorState: number): Promise<void> {
    const value = this.#toggleOnly ? "TOGGLE" : this.#levelCmd(targetDoorState);
    debug(`sending levelCmd=${value} for GarageDoor with deviceId:${this.deviceId}`);
    await this.api.putDeviceData(this.deviceId, this.endpointId, [{ name: "levelCmd", value }]);
  }

  async #readDoorState(): Promise<number> {
    const { CurrentDoorState } = this.platform.Characteristic;
    const data = await this.api.getDeviceData<TydomDeviceGarageDoorData>(
      this.deviceId,
      this.endpointId,
    );
    const level = getTydomDataPropValue<number>(data, "level") || 0;
    if (level > 0 && level < 100) {
      debug(`Encountered a ${styleString("level")} update with value different from 0 or 100 !`);
    }
    return level === 100 ? CurrentDoorState.OPEN : CurrentDoorState.CLOSED;
  }

  #applyKnownState(doorState: number): void {
    const { CurrentDoorState } = this.platform.Characteristic;
    this.#currentDoorState = doorState;
    this.#lastUpdatedAt = Date.now();
    this.#computedPosition = doorState === CurrentDoorState.OPEN ? 100 : 0;
  }

  #setDoorState(doorState: number): void {
    const { CurrentDoorState } = this.platform.Characteristic;
    debug(`assignCurrentDoorState=${styleString(this.#label(doorState))}`);
    this.#currentDoorState = doorState;
    this.#service.updateCharacteristic(CurrentDoorState, doorState);
  }

  /** Where the door has got to, given how long it has been travelling. */
  #positionNow(): number {
    const { CurrentDoorState } = this.platform.Characteristic;
    const elapsed = Date.now() - this.#lastUpdatedAt;
    switch (this.#currentDoorState) {
      case CurrentDoorState.STOPPED:
        return this.#computedPosition;
      case CurrentDoorState.OPEN:
        return 100;
      case CurrentDoorState.CLOSED:
        return 0;
      case CurrentDoorState.OPENING:
        return Math.min(100, this.#computedPosition + 100 * (elapsed / this.#travelMs));
      case CurrentDoorState.CLOSING:
        return Math.max(0, this.#computedPosition - 100 * (elapsed / this.#travelMs));
      default:
        return 0;
    }
  }

  #nextDoorState(targetDoorState: number): number {
    const { CurrentDoorState, TargetDoorState } = this.platform.Characteristic;
    switch (this.#currentDoorState) {
      case CurrentDoorState.OPENING:
      case CurrentDoorState.CLOSING:
        // Commanding a door that is already moving stops it.
        return CurrentDoorState.STOPPED;
      case CurrentDoorState.OPEN:
        return targetDoorState === TargetDoorState.CLOSED
          ? CurrentDoorState.CLOSING
          : CurrentDoorState.OPEN;
      case CurrentDoorState.CLOSED:
        return targetDoorState === TargetDoorState.OPEN
          ? CurrentDoorState.OPENING
          : CurrentDoorState.CLOSED;
      case CurrentDoorState.STOPPED:
        return targetDoorState === TargetDoorState.CLOSED
          ? CurrentDoorState.CLOSING
          : CurrentDoorState.OPENING;
      default:
        return CurrentDoorState.CLOSED;
    }
  }

  #levelCmd(targetDoorState: number): string {
    const { CurrentDoorState, TargetDoorState } = this.platform.Characteristic;
    if (
      this.#currentDoorState === CurrentDoorState.OPENING ||
      this.#currentDoorState === CurrentDoorState.CLOSING
    ) {
      return "STOP";
    }
    return targetDoorState === TargetDoorState.OPEN ? "ON" : "OFF";
  }

  #label(doorState: number): string {
    const { CurrentDoorState } = this.platform.Characteristic;
    switch (doorState) {
      case CurrentDoorState.OPEN:
        return "OPEN";
      case CurrentDoorState.CLOSED:
        return "CLOSED";
      case CurrentDoorState.OPENING:
        return "OPENING";
      case CurrentDoorState.CLOSING:
        return "CLOSING";
      case CurrentDoorState.STOPPED:
        return "STOPPED";
      default:
        return "UNKNOWN";
    }
  }
}

export const createGarageDoorAccessory = (deps: AccessoryDeps): GarageDoorAccessory =>
  new GarageDoorAccessory(deps);
