import { describe, expect, it, vi } from "vitest";
import { StateCache } from "../src/util/state-cache.js";

type Prop = { name: string; value: unknown };

const prop = (name: string, value: unknown): Prop => ({ name, value });

/** A cache with a clock the test drives, and a fetch that counts its calls. */
const setup = (options: { staleAfterMs?: number; pages?: Prop[][] } = {}) => {
  const pages = options.pages ?? [[prop("level", 0)]];
  let clock = 1_000;
  let call = 0;
  const fetch = vi.fn<() => Promise<Prop[]>>(async () => {
    const page = pages[Math.min(call, pages.length - 1)] ?? [];
    call += 1;
    return page;
  });
  const onRepair = vi.fn<(value: Prop[]) => void>();
  const onError = vi.fn<(err: unknown) => void>();
  const cache = new StateCache<Prop>({
    fetch,
    staleAfterMs: options.staleAfterMs ?? 5_000,
    onRepair,
    onError,
    now: () => clock,
  });
  return {
    cache,
    fetch,
    onRepair,
    onError,
    advance: (ms: number) => {
      clock += ms;
    },
  };
};

describe("StateCache", () => {
  it("fetches on the first read", async () => {
    const { cache, fetch } = setup();
    await expect(cache.read()).resolves.toEqual([prop("level", 0)]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("serves later reads from memory without a round trip", async () => {
    const { cache, fetch, advance } = setup();
    await cache.read();
    advance(4_999);
    await cache.read();
    await cache.read();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent cold reads onto one request", async () => {
    const { cache, fetch } = setup();
    const [a, b] = await Promise.all([cache.read(), cache.read()]);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns the stale value immediately and repairs behind it", async () => {
    const { cache, fetch, onRepair, advance } = setup({
      pages: [[prop("level", 0)], [prop("level", 100)]],
    });
    await cache.read();
    advance(5_000);

    // The point of the whole design: a stale read does not block.
    await expect(cache.read()).resolves.toEqual([prop("level", 0)]);
    await vi.waitFor(() => {
      expect(onRepair).toHaveBeenCalledWith([prop("level", 100)]);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    // And the repaired value is what the next read serves.
    await expect(cache.read()).resolves.toEqual([prop("level", 100)]);
  });

  it("does not stack repairs while one is in flight", async () => {
    const { cache, fetch, onRepair, advance } = setup();
    await cache.read();
    advance(10_000);
    await Promise.all([cache.read(), cache.read(), cache.read()]);
    await vi.waitFor(() => {
      expect(onRepair).toHaveBeenCalledTimes(1);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports a failed repair without rejecting the read", async () => {
    let attempt = 0;
    const onError = vi.fn<(err: unknown) => void>();
    let clock = 0;
    const cache = new StateCache<Prop>({
      fetch: async () => {
        attempt += 1;
        if (attempt > 1) {
          throw new Error("gateway unreachable");
        }
        return [prop("level", 0)];
      },
      staleAfterMs: 1_000,
      onRepair: vi.fn<(value: Prop[]) => void>(),
      onError,
      now: () => clock,
    });
    await cache.read();
    clock += 2_000;
    await expect(cache.read()).resolves.toEqual([prop("level", 0)]);
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    // Still serving the last thing the gateway actually said.
    await expect(cache.read()).resolves.toEqual([prop("level", 0)]);
  });

  describe("merge", () => {
    it("replaces a property by name and appends unknown ones", async () => {
      const { cache } = setup({ pages: [[prop("level", 0), prop("position", 10)]] });
      await cache.read();
      cache.merge([prop("position", 90), prop("onFavPos", true)]);
      expect(cache.peek()).toEqual([
        prop("level", 0),
        prop("position", 90),
        prop("onFavPos", true),
      ]);
    });

    it("does not make a stale record look fresh", async () => {
      // A push is the truth about the properties it carries and nothing else.
      // Letting one chatty property reset the clock would keep a quiet,
      // silently-drifted one from ever being re-read.
      const { cache, fetch, advance } = setup();
      await cache.read();
      advance(5_000);
      cache.merge([prop("level", 100)]);
      await cache.read();
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(2);
      });
    });

    it("is a no-op before anything has been read", () => {
      const { cache } = setup();
      cache.merge([prop("level", 100)]);
      expect(cache.peek()).toBeUndefined();
    });
  });

  it("reads through on every call when caching is disabled", async () => {
    const { cache, fetch } = setup({ staleAfterMs: 0 });
    await cache.read();
    await cache.read();
    await cache.read();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not repair an accessory that has been disposed", async () => {
    const { cache, onRepair, advance } = setup();
    await cache.read();
    advance(10_000);
    const pending = cache.read();
    cache.dispose();
    await pending;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onRepair).not.toHaveBeenCalled();
  });
});
