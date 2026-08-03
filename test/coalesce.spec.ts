import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WriteCoalescer } from "../src/util/coalesce.js";

const create = (leading: boolean) => {
  const sent: number[] = [];
  const send = vi.fn<(value: number) => Promise<void>>(async (value) => {
    sent.push(value);
  });
  return { sent, send, coalescer: new WriteCoalescer<number>({ delayMs: 250, leading, send }) };
};

describe("WriteCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("with leading edge (shutters, dimmers)", () => {
    it("sends the first write immediately, so a tap moves the device now", async () => {
      const { sent, coalescer } = create(true);
      coalescer.submit(50);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toEqual([50]);
    });

    it("collapses a drag into the leading write plus the final value", async () => {
      const { sent, coalescer } = create(true);
      coalescer.submit(10);
      coalescer.submit(20);
      coalescer.submit(30);
      coalescer.submit(40);
      await vi.advanceTimersByTimeAsync(300);
      expect(sent).toEqual([10, 40]);
    });

    it("does not send a trailing write when there was only one", async () => {
      const { sent, coalescer } = create(true);
      coalescer.submit(50);
      await vi.advanceTimersByTimeAsync(300);
      expect(sent).toEqual([50]);
    });

    it("treats a write after the quiet period as a new burst", async () => {
      const { sent, coalescer } = create(true);
      coalescer.submit(10);
      await vi.advanceTimersByTimeAsync(300);
      coalescer.submit(20);
      await vi.advanceTimersByTimeAsync(300);
      expect(sent).toEqual([10, 20]);
    });
  });

  describe("without leading edge", () => {
    it("sends only the last value of a burst", async () => {
      const { sent, coalescer } = create(false);
      coalescer.submit(10);
      coalescer.submit(20);
      coalescer.submit(30);
      await vi.advanceTimersByTimeAsync(300);
      expect(sent).toEqual([30]);
    });

    it("sends nothing before the quiet period elapses", async () => {
      const { sent, coalescer } = create(false);
      coalescer.submit(10);
      await vi.advanceTimersByTimeAsync(100);
      expect(sent).toEqual([]);
    });
  });

  it("serialises sends so two writes cannot land out of order", async () => {
    // The gateway applies writes in arrival order with no revision check, so an
    // overlapping pair can leave the device at the wrong position.
    const order: string[] = [];
    let resolveFirst: (() => void) | undefined;
    const send = vi.fn<(value: number) => Promise<void>>(async (value) => {
      order.push(`start:${value}`);
      if (value === 1) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
      order.push(`end:${value}`);
    });
    const coalescer = new WriteCoalescer<number>({ delayMs: 10, leading: true, send });

    coalescer.submit(1);
    await vi.advanceTimersByTimeAsync(0);
    coalescer.submit(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(order).toEqual(["start:1"]);

    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  it("keeps going after a failed send", async () => {
    const errors: unknown[] = [];
    let attempt = 0;
    const send = vi.fn<(value: number) => Promise<void>>(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("gateway busy");
    });
    const coalescer = new WriteCoalescer<number>({
      delayMs: 10,
      leading: true,
      send,
      onError: (error) => errors.push(error),
    });

    coalescer.submit(1);
    await vi.advanceTimersByTimeAsync(50);
    coalescer.submit(2);
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("flush sends the buffered value immediately", async () => {
    const { sent, coalescer } = create(false);
    coalescer.submit(42);
    await coalescer.flush();
    expect(sent).toEqual([42]);
  });

  it("dispose drops the buffered value", async () => {
    const { sent, coalescer } = create(false);
    coalescer.submit(42);
    coalescer.dispose();
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual([]);
  });
});
