import { EventEmitter } from "node:events";
import type { Logging, PlatformConfig } from "homebridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import TydomController, { type TydomControllerOptions } from "../src/controller.js";

type ClientOptions = {
  hostname?: string;
  password: string;
  retryOnClose?: boolean;
};

type Call = {
  hostname: string;
  operation: string;
  retryOnClose?: boolean | undefined;
  password?: string | undefined;
};

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

class ClientHarness {
  readonly calls: Call[] = [];
  readonly clients: FakeClient[] = [];
  readonly failures = new Map<string, Error[]>();
  readonly connectGates = new Map<string, Promise<void>[]>();

  readonly factory = ((options: ClientOptions) => {
    const client = new FakeClient(this, options);
    this.clients.push(client);
    this.calls.push({
      hostname: client.hostname,
      operation: "create",
      retryOnClose: options.retryOnClose,
      password: options.password,
    });
    return client;
  }) as unknown as NonNullable<TydomControllerOptions["clientFactory"]>;

  fail(hostname: string, operation: string, ...errors: Error[]): void {
    this.failures.set(`${hostname} ${operation}`, errors);
  }

  takeFailure(hostname: string, operation: string): Error | undefined {
    const key = `${hostname} ${operation}`;
    const failures = this.failures.get(key);
    const failure = failures?.shift();
    if (failures?.length === 0) {
      this.failures.delete(key);
    }
    return failure;
  }

  deferConnect(hostname: string): () => void {
    const { promise: gate, resolve: release } = deferred();
    const gates = this.connectGates.get(hostname) ?? [];
    gates.push(gate);
    this.connectGates.set(hostname, gates);
    return release;
  }

  takeConnectGate(hostname: string): Promise<void> | undefined {
    const gates = this.connectGates.get(hostname);
    const gate = gates?.shift();
    if (gates?.length === 0) {
      this.connectGates.delete(hostname);
    }
    return gate;
  }

  count(hostname: string, operation: string): number {
    return this.calls.filter((call) => call.hostname === hostname && call.operation === operation)
      .length;
  }
}

class FakeClient extends EventEmitter {
  readonly hostname: string;

  constructor(
    private readonly harness: ClientHarness,
    options: ClientOptions,
  ) {
    super();
    this.hostname = options.hostname ?? "mediation.tydom.com";
  }

  async connect(): Promise<unknown> {
    this.record("connect");
    this.throwFailure("connect");
    await this.harness.takeConnectGate(this.hostname);
    this.emit("connect");
    return {};
  }

  async get(uri: string): Promise<Record<string, unknown>> {
    this.record(`get ${uri}`);
    this.throwFailure(`get ${uri}`);
    return {};
  }

  async put(uri: string): Promise<Record<string, unknown>> {
    this.record(`put ${uri}`);
    this.throwFailure(`put ${uri}`);
    return {};
  }

  async post(uri: string): Promise<Record<string, unknown>> {
    this.record(`post ${uri}`);
    this.throwFailure(`post ${uri}`);
    return {};
  }

  async command(uri: string): Promise<Record<string, unknown>[]> {
    this.record(`command ${uri}`);
    this.throwFailure(`command ${uri}`);
    return [];
  }

  close(): void {
    this.record("close");
  }

  private record(operation: string): void {
    this.harness.calls.push({ hostname: this.hostname, operation });
  }

  private throwFailure(operation: string): void {
    const failure = this.harness.takeFailure(this.hostname, operation);
    if (failure) {
      throw failure;
    }
  }
}

const PRIMARY = "mediation.tydom.com";
const LOCAL = "192.168.1.42";

const rawConfig = {
  platform: "Tydom",
  hostname: PRIMARY,
  localHostname: LOCAL,
  primaryRetryInterval: 30,
  username: "001A25123456",
  password: "s3cret",
} as unknown as PlatformConfig;

const createLog = (): Logging => {
  const log = (() => {}) as unknown as Logging;
  log.info = () => {};
  log.warn = () => {};
  log.error = () => {};
  log.debug = () => {};
  log.success = () => {};
  return log;
};

const createController = (
  harness = new ClientHarness(),
  config: PlatformConfig = rawConfig,
  options: Omit<TydomControllerOptions, "clientFactory"> = {},
) => ({
  harness,
  controller: new TydomController(createLog(), parseConfig(config, {}), {
    ...options,
    clientFactory: harness.factory,
  }),
});

const connect = async (controller: TydomController): Promise<void> => {
  const connecting = controller.connect();
  await vi.advanceTimersByTimeAsync(1_000);
  await connecting;
};

describe("local fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves tydom-client automatic reconnection enabled without a fallback", () => {
    const harness = new ClientHarness();
    const config = { ...rawConfig, localHostname: undefined } as unknown as PlatformConfig;
    const { controller } = createController(harness, config);
    expect(harness.calls[0]).toMatchObject({
      hostname: PRIMARY,
      operation: "create",
      retryOnClose: true,
    });
    controller.dispose();
  });

  it("uses only the primary endpoint when it is available", async () => {
    const { controller, harness } = createController();
    await connect(controller);
    expect(controller.isConnected).toBe(true);
    expect((controller.client as unknown as FakeClient).hostname).toBe(PRIMARY);
    expect(harness.count(LOCAL, "connect")).toBe(0);
    expect(harness.calls.filter((call) => call.operation === "create")).toSatisfy((calls: Call[]) =>
      calls.every((call) => call.retryOnClose === false),
    );
    controller.dispose();
  });

  it("falls back locally during startup when the primary is unavailable", async () => {
    const harness = new ClientHarness();
    harness.fail(PRIMARY, "connect", new Error("ECONNREFUSED"));
    const { controller } = createController(harness);
    await connect(controller);
    expect((controller.client as unknown as FakeClient).hostname).toBe(LOCAL);
    expect(harness.count(PRIMARY, "connect")).toBe(1);
    expect(harness.count(LOCAL, "connect")).toBe(1);
    controller.dispose();
  });

  it("lets the platform own startup retries when both endpoints are unavailable", async () => {
    const harness = new ClientHarness();
    harness.fail(PRIMARY, "connect", new Error("ECONNREFUSED"));
    harness.fail(LOCAL, "connect", new Error("ECONNREFUSED"));
    const { controller } = createController(harness);
    const connecting = controller.connect();
    const outcome = connecting.then(
      () => undefined,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toEqual(expect.objectContaining({ message: "ECONNREFUSED" }));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(harness.count(PRIMARY, "connect")).toBe(1);
    expect(harness.count(LOCAL, "connect")).toBe(1);
    controller.dispose();
  });

  it("switches to local after the active primary disconnects", async () => {
    const { controller, harness } = createController();
    await connect(controller);
    (controller.client as unknown as FakeClient).emit("disconnect");
    await vi.advanceTimersByTimeAsync(6_000);
    expect((controller.client as unknown as FakeClient).hostname).toBe(LOCAL);
    expect(harness.count(LOCAL, "connect")).toBe(1);
    controller.dispose();
  });

  it("reconnects local-first when the fallback itself disconnects", async () => {
    const harness = new ClientHarness();
    harness.fail(PRIMARY, "connect", new Error("ECONNREFUSED"));
    const { controller } = createController(harness);
    await connect(controller);
    (controller.client as unknown as FakeClient).emit("disconnect");
    await vi.advanceTimersByTimeAsync(6_000);
    expect((controller.client as unknown as FakeClient).hostname).toBe(LOCAL);
    expect(harness.count(LOCAL, "connect")).toBe(2);
    controller.dispose();
  });

  it("collapses simultaneous read failures into one transition and retries both reads", async () => {
    const { controller, harness } = createController();
    await connect(controller);
    harness.fail(
      PRIMARY,
      "get /devices/a",
      new Error("Socket closed while request was pending"),
      new Error("Socket closed while request was pending"),
    );
    const reads = Promise.all([
      controller.transport.get("/devices/a"),
      controller.transport.get("/devices/a"),
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    await reads;
    expect(harness.count(LOCAL, "connect")).toBe(1);
    expect(harness.count(LOCAL, "get /devices/a")).toBe(2);
    controller.dispose();
  });

  it("does not replay an ambiguous write after a timeout", async () => {
    const { controller, harness } = createController();
    await connect(controller);
    harness.fail(PRIMARY, "put /devices/a", new Error("Request timed out after 5000ms"));
    const writing = controller.transport.put("/devices/a", { level: 100 });
    const outcome = writing.then(
      () => undefined,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toEqual(
      expect.objectContaining({ message: "Request timed out after 5000ms" }),
    );
    expect((controller.client as unknown as FakeClient).hostname).toBe(LOCAL);
    expect(harness.count(LOCAL, "put /devices/a")).toBe(0);
    controller.dispose();
  });

  it("replays a write that was definitely rejected before socket.send", async () => {
    const { controller, harness } = createController();
    await connect(controller);
    harness.fail(
      PRIMARY,
      "put /devices/a",
      new Error("Socket instance is closing/closed, please reconnect"),
    );
    const writing = controller.transport.put("/devices/a", { level: 100 });
    await vi.advanceTimersByTimeAsync(1_000);
    await writing;
    expect(harness.count(LOCAL, "put /devices/a")).toBe(1);
    controller.dispose();
  });

  it("does not switch hosts for an application-level failure", async () => {
    const { controller, harness } = createController();
    await connect(controller);
    harness.fail(PRIMARY, "get /devices/a", new Error("Unexpected response shape"));
    await expect(controller.transport.get("/devices/a")).rejects.toThrow(
      "Unexpected response shape",
    );
    expect(harness.count(LOCAL, "connect")).toBe(0);
    controller.dispose();
  });

  it("probes and restores the primary without interrupting the local client", async () => {
    const harness = new ClientHarness();
    harness.fail(PRIMARY, "connect", new Error("ECONNREFUSED"));
    const { controller } = createController(harness);
    await connect(controller);
    const local = controller.client;
    await vi.advanceTimersByTimeAsync(31_000);
    expect((controller.client as unknown as FakeClient).hostname).toBe(PRIMARY);
    expect(harness.count(PRIMARY, "connect")).toBe(2);
    expect(
      harness.calls.findIndex((call) => call.hostname === LOCAL && call.operation === "close"),
    ).toBeGreaterThan(
      harness.calls.findIndex(
        (call) => call.hostname === PRIMARY && call.operation === "get /ping",
      ),
    );
    expect(local).not.toBe(controller.client);
    controller.dispose();
  });

  it("keeps serving locally after a failed primary probe and schedules another", async () => {
    const harness = new ClientHarness();
    harness.fail(
      PRIMARY,
      "connect",
      new Error("startup unavailable"),
      new Error("probe unavailable"),
    );
    const { controller } = createController(harness);
    await connect(controller);
    await vi.advanceTimersByTimeAsync(31_000);
    expect((controller.client as unknown as FakeClient).hostname).toBe(LOCAL);
    await vi.advanceTimersByTimeAsync(31_000);
    expect((controller.client as unknown as FakeClient).hostname).toBe(PRIMARY);
    expect(harness.count(PRIMARY, "connect")).toBe(3);
    controller.dispose();
  });

  it("keeps the resolved gateway password for both endpoints", async () => {
    const harness = new ClientHarness();
    harness.fail(PRIMARY, "connect", new Error("ECONNREFUSED"));
    const accountConfig = {
      ...rawConfig,
      email: "owner@example.test",
    } as unknown as PlatformConfig;
    const resolver = vi.fn<() => Promise<string>>(async () => "gateway-secret");
    const { controller } = createController(harness, accountConfig, {
      gatewayPasswordResolver: resolver,
    });
    await connect(controller);
    expect(resolver).toHaveBeenCalledOnce();
    const connectedClients = harness.calls.filter((call) => call.operation === "connect");
    for (const connected of connectedClients) {
      const creations = harness.calls.filter(
        (call) => call.operation === "create" && call.hostname === connected.hostname,
      );
      expect(creations.some((creation) => creation.password === "gateway-secret")).toBe(true);
    }
    controller.dispose();
  });

  it("cancels reconnect and primary-probe timers on dispose", async () => {
    const harness = new ClientHarness();
    harness.fail(PRIMARY, "connect", new Error("ECONNREFUSED"));
    const { controller } = createController(harness);
    await connect(controller);
    const connectCount = harness.calls.filter((call) => call.operation === "connect").length;
    controller.dispose();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(harness.calls.filter((call) => call.operation === "connect")).toHaveLength(connectCount);
  });

  it("closes a connection candidate when disposed during a transition", async () => {
    const harness = new ClientHarness();
    const release = harness.deferConnect(PRIMARY);
    const { controller } = createController(harness);
    const connecting = controller.connect();
    const outcome = connecting.then(
      () => undefined,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(0);
    const candidate = harness.clients.at(-1);
    controller.dispose();
    expect(harness.calls).toContainEqual({ hostname: PRIMARY, operation: "close" });
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toEqual(
      expect.objectContaining({ message: "Tydom controller was disposed while connecting" }),
    );
    expect(candidate).toBe(controller.client);
    expect(controller.isConnected).toBe(false);
  });
});
