/** Anything shaped like a Tydom endpoint property. */
export type NamedValue = { name: string };

export type StateCacheOptions<T extends NamedValue> = {
  /** Fetch the endpoint's full data. Called at most once at a time. */
  fetch: () => Promise<T[]>;
  /**
   * How long a full read stays authoritative. `0` disables caching entirely,
   * which restores the pre-0.30 behaviour of a round trip per read.
   */
  staleAfterMs: number;
  /**
   * Called with fresh data after a background repair, so the owner can push the
   * corrected values out. Never called for the blocking first read — the caller
   * is already about to return that data itself.
   */
  onRepair: (value: T[]) => void;
  /** Called if a background repair fails. A repair failure is not fatal. */
  onError?: (err: unknown) => void;
  /** Injectable for tests. */
  now?: () => number;
};

/**
 * Endpoint data held locally, repaired lazily.
 *
 * The gateway is push-first: it tells us when something changes, so re-reading
 * on every HomeKit query is mostly wasted traffic on a small embedded box that
 * is documented to cope badly with chatty clients. But unlike a polling plugin,
 * this one has no periodic re-read to fall back on — a missed push would
 * otherwise leave HomeKit wrong until the four-hourly refresh.
 *
 * So: reads are served from memory and never block once warm, and a read that
 * finds the data older than `staleAfterMs` returns the cached value *and* kicks
 * a refresh whose result is pushed out through `onRepair`. Bounded staleness
 * rather than either extreme.
 */
export class StateCache<T extends NamedValue> {
  readonly #options: StateCacheOptions<T>;
  readonly #now: () => number;

  #value: T[] | undefined;
  /**
   * When the last *full* read landed.
   *
   * Deliberately not advanced by `merge`. A push tells the truth about the
   * properties it carries and nothing else, so treating a partial update as
   * proof of overall freshness would let one chatty property keep a quiet,
   * silently-drifted one from ever being re-read.
   */
  #fetchedAt = 0;
  #inFlight: Promise<T[]> | undefined;
  #disposed = false;

  constructor(options: StateCacheOptions<T>) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** The current data, fetching only if there is nothing to serve. */
  async read(): Promise<T[]> {
    if (this.#options.staleAfterMs <= 0) {
      return this.#fetch();
    }
    const cached = this.#value;
    if (!cached) {
      return this.#fetch();
    }
    if (this.#now() - this.#fetchedAt >= this.#options.staleAfterMs) {
      this.#repair();
    }
    return cached;
  }

  /** Whatever is held right now, without ever fetching. */
  peek(): T[] | undefined {
    return this.#value;
  }

  /**
   * Fold a push into the held data.
   *
   * Properties are replaced by name and unknown ones appended, so a partial
   * update never truncates the record.
   */
  merge(updates: readonly T[]): void {
    if (!this.#value) {
      return;
    }
    const next = [...this.#value];
    for (const update of updates) {
      const index = next.findIndex((prop) => prop.name === update.name);
      if (index === -1) {
        next.push(update);
      } else {
        next[index] = update;
      }
    }
    this.#value = next;
  }

  dispose(): void {
    this.#disposed = true;
    this.#value = undefined;
    this.#inFlight = undefined;
  }

  async #fetch(): Promise<T[]> {
    // Collapse concurrent callers onto one request. The api client dedupes over
    // a one-second window too, but a slow gateway read outlives that easily.
    this.#inFlight ??= this.#options
      .fetch()
      .then((value) => {
        if (!this.#disposed) {
          this.#value = value;
          this.#fetchedAt = this.#now();
        }
        return value;
      })
      .finally(() => {
        this.#inFlight = undefined;
      });
    return this.#inFlight;
  }

  #repair(): void {
    // A refresh is already on its way; piling on would only re-run `onRepair`
    // with the same data.
    if (this.#inFlight) {
      return;
    }
    void this.#fetch()
      .then((value) => {
        if (!this.#disposed) {
          this.#options.onRepair(value);
        }
        return undefined;
      })
      .catch((err: unknown) => {
        // A failed repair leaves the stale value in place, which is the right
        // answer: it is the last thing the gateway actually told us.
        this.#options.onError?.(err);
      });
  }
}
