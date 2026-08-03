import { describe, expect, it, vi } from "vitest";
import { RequestCache } from "../src/api/cache.js";

describe("RequestCache", () => {
  it("collapses repeat reads of the same key inside the window", async () => {
    const cache = new RequestCache(1000);
    const task = vi.fn<() => Promise<string>>(async () => "value");

    const a = cache.run("/a", task, 0);
    const b = cache.run("/a", task, 500);

    expect(await a).toBe("value");
    expect(await b).toBe("value");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("re-runs once the window has passed", async () => {
    const cache = new RequestCache(1000);
    const task = vi.fn<() => Promise<string>>(async () => "value");

    await cache.run("/a", task, 0);
    await cache.run("/a", task, 1001);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it("keys distinct URIs separately", async () => {
    const cache = new RequestCache(1000);
    const task = vi.fn<() => Promise<string>>(async () => "value");

    await cache.run("/a", task, 0);
    await cache.run("/b", task, 0);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it("evicts a rejected promise rather than caching the failure", async () => {
    // Regression for d193f94: a failed read used to be cached for the rest of
    // the window, so one blip made the device look dead for a full second.
    const cache = new RequestCache(1000);
    let attempt = 0;
    const task = vi.fn<() => Promise<string>>(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("boom");
      return "recovered";
    });

    await expect(cache.run("/a", task, 0)).rejects.toThrow("boom");
    expect(cache.size).toBe(0);
    await expect(cache.run("/a", task, 1)).resolves.toBe("recovered");
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("does not evict a newer entry when an older one rejects", async () => {
    const cache = new RequestCache(0);
    const slowFailure = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("late")), 5),
    );

    const first = cache.run("/a", () => slowFailure, 0);
    const second = cache.run("/a", async () => "fresh", 1);

    await expect(first).rejects.toThrow("late");
    await expect(second).resolves.toBe("fresh");
    // The late rejection must not have removed the entry the retry installed.
    expect(cache.size).toBe(1);
  });

  it("is a no-op cache at windowMs 0, which is how tests disable it", async () => {
    const cache = new RequestCache(0);
    const task = vi.fn<() => Promise<string>>(async () => "value");

    await cache.run("/a", task, 0);
    await cache.run("/a", task, 0);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it("clears", async () => {
    const cache = new RequestCache(1000);
    await cache.run("/a", async () => "value", 0);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
