/**
 * A short read-through cache that collapses duplicate in-flight requests.
 *
 * HomeKit fans a single "open the Home app" into one `onGet` per characteristic,
 * and several of those characteristics read the same endpoint. Without this, one
 * screen refresh becomes a burst of identical requests at the gateway.
 *
 * Instance-scoped on purpose. The version this replaces was a module-level Map,
 * which leaked between two Tydom platforms in one Homebridge process — a real
 * configuration for anyone with more than one gateway — and could not be tested.
 */
export class RequestCache {
  readonly #entries = new Map<string, { at: number; promise: Promise<unknown> }>();

  /** @param windowMs how long a result stays fresh. Tests pass 0 to disable. */
  constructor(private readonly windowMs: number) {}

  /**
   * Return the cached promise for `key`, or run `task` and cache it.
   *
   * A rejected promise is evicted rather than cached, so one failed read does
   * not poison every subsequent one for the rest of the window.
   */
  run<T>(key: string, task: () => Promise<T>, now: number = Date.now()): Promise<T> {
    const entry = this.#entries.get(key);
    if (entry && now < entry.at + this.windowMs) {
      return entry.promise as Promise<T>;
    }

    const promise = task();
    promise.catch(() => {
      // Only evict if we are still the current entry; a later request may have
      // already replaced us.
      if (this.#entries.get(key)?.promise === promise) {
        this.#entries.delete(key);
      }
    });
    this.#entries.set(key, { at: now, promise });
    return promise;
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
