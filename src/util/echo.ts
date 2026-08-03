/**
 * Swallows the gateway's echo of this plugin's own writes.
 *
 * Tydom pushes every change back as a `/devices/data` update, including the
 * ones we just made. Without suppression each write round-trips into a
 * redundant `updateCharacteristic`, and during a slider drag the echo of an
 * earlier position fights the user's next move.
 *
 * Keyed by property *and* value with a TTL. The version this replaces kept a
 * bare array of pending values and cleared the whole thing on the first match,
 * so with two writes in flight the second echo was let through.
 */
export class EchoSuppressor {
  readonly #ttlMs: number;
  readonly #expected = new Map<string, number[]>();

  constructor(ttlMs = 5000) {
    this.#ttlMs = ttlMs;
  }

  /** Record a value we just wrote, so its echo can be recognised. */
  expect(name: string, value: unknown, now: number = Date.now()): void {
    const key = this.#key(name, value);
    const stamps = this.#expected.get(key) ?? [];
    stamps.push(now);
    this.#expected.set(key, stamps);
  }

  /**
   * Consume one expectation.
   *
   * Returns true when this update is our own echo and should be dropped.
   * Consuming removes exactly one expectation, so N writes of the same value
   * swallow N echoes and no more.
   */
  consume(name: string, value: unknown, now: number = Date.now()): boolean {
    const key = this.#key(name, value);
    const stamps = this.#expected.get(key);
    if (!stamps || stamps.length === 0) {
      return false;
    }
    // Drop anything that aged out; a missing echo must not suppress a real
    // change made from the Tydom app minutes later.
    const fresh = stamps.filter((at) => now - at <= this.#ttlMs);
    if (fresh.length === 0) {
      this.#expected.delete(key);
      return false;
    }
    fresh.shift();
    if (fresh.length === 0) {
      this.#expected.delete(key);
    } else {
      this.#expected.set(key, fresh);
    }
    return true;
  }

  dispose(): void {
    this.#expected.clear();
  }

  get size(): number {
    return this.#expected.size;
  }

  #key(name: string, value: unknown): string {
    return `${name}:${JSON.stringify(value)}`;
  }
}
