/**
 * Collapses a burst of writes to one property into as few requests as possible.
 *
 * HomeKit delivers a slider drag as a stream of individual characteristic
 * writes. Sending each one would flood the gateway and, on a device that
 * physically moves, make it stutter.
 *
 * `leading` matters more than it looks: with it on, the first write goes out
 * immediately, so a single tap moves the shutter now rather than 250 ms from
 * now. It is what makes the plugin feel responsive, and is on for the two
 * accessories that drive moving hardware.
 *
 * Flushes are chained rather than merely debounced, because the gateway applies
 * writes in arrival order with no revision check — two in flight at once can
 * land backwards and leave the device at the wrong position.
 */
export type WriteCoalescerOptions<T> = {
  /** Quiet period before the trailing write. */
  delayMs: number;
  /** Send the first write of a burst immediately. Default false. */
  leading?: boolean;
  send: (value: T) => Promise<void>;
  onError?: (error: unknown) => void;
};

export class WriteCoalescer<T> {
  readonly #delayMs: number;
  readonly #leading: boolean;
  readonly #send: (value: T) => Promise<void>;
  readonly #onError: (error: unknown) => void;

  #timer: NodeJS.Timeout | undefined;
  #pending: { value: T } | undefined;
  #inFlight: Promise<void> = Promise.resolve();
  /** True between the leading write and the end of the quiet period. */
  #burst = false;
  /**
   * What the leading write of the current burst sent, so the trailing write can
   * be skipped when it would repeat it.
   *
   * Cleared at the end of each burst: a value resubmitted later is a fresh user
   * action, and may legitimately be re-asserting a state the device drifted
   * away from while a push was missed.
   */
  #sentInBurst: { value: T } | undefined;

  constructor(options: WriteCoalescerOptions<T>) {
    this.#delayMs = options.delayMs;
    this.#leading = options.leading ?? false;
    this.#send = options.send;
    this.#onError = options.onError ?? (() => undefined);
  }

  submit(value: T): void {
    if (this.#leading && !this.#burst) {
      // First of a burst: go out now, and open the quiet period.
      this.#burst = true;
      this.#sentInBurst = { value };
      this.#dispatch(value);
      this.#arm();
      return;
    }
    this.#pending = { value };
    this.#arm();
  }

  /** Send anything buffered now, and resolve once it has landed. */
  async flush(): Promise<void> {
    this.#clearTimer();
    this.#burst = false;
    const pending = this.#pending;
    this.#pending = undefined;
    this.#sentInBurst = undefined;
    if (pending) {
      this.#dispatch(pending.value);
    }
    return this.#inFlight;
  }

  /** Drop anything buffered and stop the timer. Does not cancel a live send. */
  dispose(): void {
    this.#clearTimer();
    this.#pending = undefined;
    this.#sentInBurst = undefined;
    this.#burst = false;
  }

  #arm(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#burst = false;
      const pending = this.#pending;
      this.#pending = undefined;
      const sent = this.#sentInBurst;
      this.#sentInBurst = undefined;
      // Skip a trailing write that only repeats the leading one. HomeKit maps
      // several characteristics onto one property — setting a dimmer's On and
      // Brightness together arrives as two writes of the same level — so
      // without this every such gesture costs the gateway two identical PUTs.
      if (pending && !(sent && Object.is(sent.value, pending.value))) {
        this.#dispatch(pending.value);
      }
    }, this.#delayMs);
    this.#timer.unref?.();
  }

  #clearTimer(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  #dispatch(value: T): void {
    this.#inFlight = this.#inFlight
      .catch(() => undefined)
      .then(() => this.#send(value))
      .catch((error: unknown) => {
        this.#onError(error);
      });
  }
}
