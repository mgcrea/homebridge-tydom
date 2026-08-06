import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestPacer } from "../src/api/pacer.js";

describe("RequestPacer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the first request through immediately", async () => {
    const pacer = new RequestPacer(100);
    await expect(pacer.run(async () => "now")).resolves.toBe("now");
  });

  it("spaces concurrent starts by the interval", async () => {
    const pacer = new RequestPacer(100);
    const starts: number[] = [];
    const record = () => {
      starts.push(Date.now());
      return Promise.resolve();
    };

    const all = Promise.all([pacer.run(record), pacer.run(record), pacer.run(record)]);
    await vi.advanceTimersByTimeAsync(500);
    await all;

    expect(starts).toHaveLength(3);
    const first = starts[0] ?? 0;
    expect((starts[1] ?? 0) - first).toBe(100);
    expect((starts[2] ?? 0) - first).toBe(200);
  });

  it("does not make a slow request delay the next one further", async () => {
    // Starts are spaced; completions are not serialised. A queue that waited
    // for each request to finish would stall everything behind one slow relayed
    // response, and HomeKit reports an accessory as unresponsive long before it
    // would clear.
    const pacer = new RequestPacer(50);
    const starts: number[] = [];
    const slow = () => {
      starts.push(Date.now());
      return new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    };
    const quick = () => {
      starts.push(Date.now());
      return Promise.resolve();
    };

    void pacer.run(slow);
    const second = pacer.run(quick);
    await vi.advanceTimersByTimeAsync(100);
    await second;

    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBe(50);
  });

  it("does not hold a slot open when a request rejects", async () => {
    const pacer = new RequestPacer(50);
    await expect(pacer.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const after = pacer.run(async () => "fine");
    await vi.advanceTimersByTimeAsync(100);
    await expect(after).resolves.toBe("fine");
  });

  it("reclaims idle time rather than banking it", async () => {
    // After a quiet period the next request starts at once — the floor is a gap
    // between starts, not a budget that accrues.
    const pacer = new RequestPacer(100);
    await pacer.run(async () => undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    const startedAt = Date.now();
    const observed: number[] = [];
    const run = pacer.run(async () => {
      observed.push(Date.now());
    });
    await vi.advanceTimersByTimeAsync(0);
    await run;
    expect(observed[0]).toBe(startedAt);
  });

  it("is a no-op at zero", async () => {
    const pacer = new RequestPacer(0);
    const starts: number[] = [];
    const record = async () => {
      starts.push(Date.now());
    };
    await Promise.all([pacer.run(record), pacer.run(record), pacer.run(record)]);
    expect(new Set(starts).size).toBe(1);
  });

  it("treats a negative interval as zero", async () => {
    const pacer = new RequestPacer(-100);
    await expect(pacer.run(async () => "ok")).resolves.toBe("ok");
  });
});
