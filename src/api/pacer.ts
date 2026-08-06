/**
 * A floor on how often requests may be *started*.
 *
 * The Tydom gateway is a small embedded box, and nothing upstream of here
 * bounds the rate it is asked at: `RequestCache` collapses identical concurrent
 * reads and `WriteCoalescer` merges writes to one device, but a Home app
 * refresh or a scene still fans out across every device at once, one request
 * each, all in the same tick.
 *
 * Starts are spaced; completions are not serialised. A queue that waits for
 * each request to finish before starting the next would let one slow response —
 * ordinary over `mediation.tydom.com`, where every frame is relayed through
 * Delta Dore — stall every unrelated request behind it, and HomeKit gives a
 * characteristic read only a few seconds before it reports the accessory as not
 * responding. Spacing starts bounds the burst without coupling latencies.
 */
export class RequestPacer {
  readonly #minIntervalMs: number;
  /** Earliest epoch time the next request may start. */
  #nextSlot = 0;

  constructor(minIntervalMs: number) {
    this.#minIntervalMs = Math.max(0, minIntervalMs);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#waitForSlot();
    return task();
  }

  /**
   * Claim the next slot.
   *
   * The slot is reserved before the wait, not after, so concurrent callers each
   * take a distinct one instead of all reading the same `now` and departing
   * together.
   */
  async #waitForSlot(): Promise<void> {
    if (this.#minIntervalMs === 0) {
      return;
    }
    const now = Date.now();
    const start = Math.max(now, this.#nextSlot);
    this.#nextSlot = start + this.#minIntervalMs;
    const delay = start - now;
    if (delay <= 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      timer.unref?.();
    });
  }
}
