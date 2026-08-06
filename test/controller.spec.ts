import type { Logging } from "homebridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TydomController from "../src/controller.js";
import type { TydomPlatformConfig } from "../src/platform.js";

/**
 * Stand a controller up without a socket.
 *
 * `createTydomClient` only builds closures, so constructing the real client
 * opens nothing. Its four network methods are replaced and its events are
 * driven by hand, which is what lets the reconnection paths — the ones with no
 * coverage at all until now — be exercised deterministically.
 */
const createController = () => {
  const messages: string[] = [];
  const log = ((message: string) => messages.push(message)) as unknown as Logging;
  log.info = (message: string) => messages.push(`info: ${message}`);
  log.warn = (message: string) => messages.push(`warn: ${message}`);
  log.error = (message: string) => messages.push(`error: ${message}`);
  log.debug = (message: string) => messages.push(`debug: ${message}`);
  log.success = (message: string) => messages.push(`success: ${message}`);

  const config = {
    hostname: "mediation.tydom.com",
    username: "001A25123456",
    password: "s3cret",
    email: undefined,
    locale: "fr",
    refreshIntervalMs: 60_000,
    staleAfterMs: 0,
    settings: {},
    webhooks: [],
    includedDevices: [],
    excludedDevices: [],
    includedCategories: [],
    excludedCategories: [],
    debug: false,
  } as unknown as TydomPlatformConfig;

  const controller = new TydomController(log, config);
  const calls: string[] = [];
  const client = controller.client as unknown as Record<string, unknown>;
  client["connect"] = async () => {
    calls.push("connect");
    return undefined;
  };
  client["get"] = async (uri: string) => {
    calls.push(`get ${uri}`);
    return {};
  };
  client["post"] = async (uri: string) => {
    calls.push(`post ${uri}`);
    return {};
  };
  client["close"] = () => {
    calls.push("close");
  };

  return { controller, messages, calls };
};

/** Drive the client's own event, as `tydom-client` would on a socket change. */
const emitClient = (controller: TydomController, event: string): void => {
  (controller.client as unknown as { emit: (name: string) => void }).emit(event);
};

describe("TydomController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("connection state", () => {
    it("tracks a socket it did not itself ask for", () => {
      // tydom-client reconnects on its own, so a connection can appear without
      // anyone here having called connect.
      const { controller } = createController();
      expect(controller.isConnected).toBe(false);
      emitClient(controller, "connect");
      expect(controller.isConnected).toBe(true);
      emitClient(controller, "disconnect");
      expect(controller.isConnected).toBe(false);
      controller.dispose();
    });
  });

  describe("resync after reconnection", () => {
    it("does not resync on the first connection", async () => {
      // The socket coming up for the first time is not a reconnection: the
      // caller is about to scan, which syncs everything anyway.
      const { controller, calls } = createController();
      emitClient(controller, "connect");
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toEqual([]);
      controller.dispose();
    });

    it("collapses overlapping reconnections into one trailing resync", async () => {
      // A flapping socket emits connect repeatedly. Each one used to start its
      // own resync, all in flight together, each re-arming the interval the
      // last had just installed.
      const { controller, calls } = createController();
      await reachFirstConnectionFor(controller);
      calls.length = 0;

      emitClient(controller, "connect");
      emitClient(controller, "connect");
      emitClient(controller, "connect");
      await vi.advanceTimersByTimeAsync(1000);

      // One run for the first, one queued for everything that arrived during
      // it — not three.
      expect(calls.filter((call) => call === "get /ping")).toHaveLength(2);
      controller.dispose();
    });

    it("re-arms the refresh interval an unref'd timer would not hold open", async () => {
      const { controller, calls } = createController();
      await reachFirstConnectionFor(controller);
      emitClient(controller, "disconnect");
      calls.length = 0;

      emitClient(controller, "connect");
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toContain("post /refresh/all");

      calls.length = 0;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toContain("post /refresh/all");
      controller.dispose();
    });
  });

  describe("dispose", () => {
    it("stops reacting to a client that reconnects anyway", async () => {
      // client.close() cannot stop tydom-client: its socket close handler calls
      // scheduleReconnect unconditionally, and the flag that would suppress it
      // is only set by its own signal handler. So a reconnection after shutdown
      // is expected — reacting to one is not.
      const { controller, calls } = createController();
      await reachFirstConnectionFor(controller);
      controller.dispose();
      calls.length = 0;

      emitClient(controller, "connect");
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toEqual([]);
    });

    it("does not let a post-dispose refresh keep the process alive", async () => {
      const { controller, calls } = createController();
      await reachFirstConnectionFor(controller);
      controller.dispose();
      calls.length = 0;
      await vi.advanceTimersByTimeAsync(180_000);
      expect(calls).toEqual([]);
    });

    it("abandons a resync already in flight", async () => {
      // Detaching listeners covers a reconnection that arrives after shutdown,
      // but not a resync that was already running when it landed: that one has
      // its own continuation and would re-arm the refresh interval the platform
      // has just cleared.
      const { controller, calls } = createController();
      await reachFirstConnectionFor(controller);
      emitClient(controller, "disconnect");

      emitClient(controller, "connect");
      // Land in the middle of the resync's opening 250 ms wait.
      await vi.advanceTimersByTimeAsync(100);
      controller.dispose();
      calls.length = 0;

      await vi.advanceTimersByTimeAsync(180_000);
      expect(calls).toEqual([]);
    });

    it("is idempotent", async () => {
      const { controller, calls } = createController();
      await reachFirstConnectionFor(controller);
      controller.dispose();
      controller.dispose();
      expect(calls.filter((call) => call === "close")).toHaveLength(2);
    });
  });
});

/** Shared by the dispose block; kept out of it so both describes can use it. */
async function reachFirstConnectionFor(controller: TydomController): Promise<void> {
  const connecting = controller.connect();
  await vi.advanceTimersByTimeAsync(300);
  await connecting;
}
