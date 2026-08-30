import { EventEmitter } from "node:events";
import type { Logging } from "homebridge";
import type { Categories } from "homebridge";
import { createTranslator, type Translator } from "./i18n/index.js";
import type { TydomTransport } from "./api/client.js";
import { discoverDevices, expandCompanions } from "./api/discovery.js";
import {
  classifyMessage,
  getAccessoryId,
  getUniqueId,
  parseDeviceDataUpdate,
} from "./api/messages.js";
import {
  parseDiscoveryResponse,
  tydomConfigResponseSchema,
  tydomGroupsResponseSchema,
  tydomMetaResponseSchema,
  type TydomUpdateType,
} from "./api/types.js";
import type { TydomUpdateType as TydomAccessoryUpdateType } from "./api/types.js";
import { asyncWait } from "./util/async.js";
import type { TydomPlatformConfig } from "./platform.js";
import type {
  TydomAccessoryContext,
  TydomAccessoryUpdateContext,
  TydomConfigResponse,
  TydomGroupsResponse,
  TydomMetaResponse,
} from "./typings/tydom.js";
import {
  styleGet,
  styleJson,
  styleKeyword,
  styleNumber,
  styleString,
  styleUpd,
} from "./util/style.js";
import { debug } from "./platform/trace.js";
import { stringifyError } from "./util/error.js";
import { resolveGatewayPassword } from "./util/deltadore.js";
import { maskEmail } from "./util/redact.js";
import type TydomClient from "tydom-client";
import {
  createClient as createTydomClient,
  type TydomHttpMessage,
  type TydomRequestBody,
  type TydomResponse,
} from "tydom-client";

export type ControllerDevicePayload = TydomAccessoryContext;

export type ControllerUpdatePayload = {
  type: TydomAccessoryUpdateType;
  category: Categories;
  updates: Record<string, unknown>[];
  context: TydomAccessoryContext;
};

type ConnectionTarget = {
  hostname: string;
  type: "primary" | "local";
};

type TransportRetry = "safe" | "only-if-unsent";

export type TydomControllerOptions = {
  clientFactory?: typeof createTydomClient;
  gatewayPasswordResolver?: typeof resolveGatewayPassword;
};

const RECONNECT_BASE_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 5 * 60_000;

export default class TydomController extends EventEmitter {
  public client: TydomClient;
  public readonly transport: TydomTransport;
  public config: TydomPlatformConfig;
  public log: Logging;
  private readonly clientFactory: typeof createTydomClient;
  private readonly gatewayPasswordResolver: typeof resolveGatewayPassword;
  private readonly managedFallback: boolean;
  private activeTarget: ConnectionTarget;
  private transitionPromise: Promise<void> | undefined;
  private transitionClient: TydomClient | undefined;
  private initialClientAvailable = true;
  private reconnectTimeout: NodeJS.Timeout | undefined;
  private primaryRetryTimeout: NodeJS.Timeout | undefined;
  private primaryProbeClient: TydomClient | undefined;
  private reconnectAttempt = 0;
  /**
   * Known endpoints, by `deviceId:endpointId`.
   *
   * Only a gate for inbound pushes — `handleDeviceDataUpdate` uses it to tell a
   * device it discovered from one it did not. Companions share their primary's
   * endpoint, so only the primary ever writes here.
   */
  private devices = new Map<string, Categories>();
  /**
   * Accessories already announced to the platform, by `accessoryId`.
   *
   * Separate from `devices` because a companion shares the primary's endpoint
   * but is a distinct accessory. Deduping the announcement on the endpoint
   * instead — which is what this used to do — silently swallowed every
   * companion, since the primary always claimed the key first.
   */
  private emitted = new Set<string>();
  private refreshInterval: NodeJS.Timeout | undefined;
  private hasConnectedOnce = false;
  /**
   * Whether a socket is currently up.
   *
   * `tydom-client` reconnects on its own (`retryOnClose` defaults to true), so
   * a connection can appear without anyone here having asked for one. The
   * platform's startup ladder consults this so the two do not each open a
   * socket and each drive a scan.
   */
  private connected = false;
  /**
   * Set by `dispose`, and never cleared.
   *
   * `client.close()` cannot actually stop `tydom-client`: its socket `close`
   * handler calls `scheduleReconnect` unconditionally, and the `isExiting` flag
   * that would suppress that is only set by its own SIGINT/SIGTERM handler. So
   * a Homebridge `shutdown` leaves the client reconnecting, and every
   * reconnection used to re-arm the refresh interval the platform had just
   * cleared and replay device state into disposed handlers. We cannot stop it
   * reconnecting from out here; we can stop reacting to it.
   */
  private disposed = false;
  /** The resync in flight, if any; see `resync`. */
  private resyncing: Promise<void> | undefined;
  private pendingResync = false;
  /**
   * The gateway password actually in use.
   *
   * Empty until `connect` derives it, when the platform was configured with an
   * account e-mail — in which case `config.password` is the account's, not the
   * gateway's, and must never reach the gateway.
   */
  private gatewayPassword: string;
  /** Delta Dore label lookups, bound to the configured locale. */
  private readonly t: Translator;
  constructor(log: Logging, config: TydomPlatformConfig, options: TydomControllerOptions = {}) {
    super();
    this.config = config;
    this.log = log;
    this.clientFactory = options.clientFactory ?? createTydomClient;
    this.gatewayPasswordResolver = options.gatewayPasswordResolver ?? resolveGatewayPassword;
    this.managedFallback = Boolean(config.localHostname);
    this.t = createTranslator(config.locale);
    // hostname/username/password are validated and resolved by parseConfig,
    // so there is nothing left to assert here.
    const { hostname, password, email } = config;
    // With an e-mail configured, `password` belongs to the account rather than
    // the gateway, so the client starts out with no usable credential and
    // `connect` fills one in.
    this.gatewayPassword = email ? "" : password;
    this.activeTarget = { hostname, type: "primary" };
    this.client = this.createClientForTarget(this.activeTarget);
    this.transport = {
      get: async (uri) => await this.runTransport((client) => client.get(uri), "safe"),
      put: async (uri, body) =>
        await this.runTransport(
          (client) => client.put(uri, body as TydomRequestBody | undefined),
          "only-if-unsent",
        ),
      post: async (uri, body) =>
        await this.runTransport(
          (client) => client.post(uri, body as TydomRequestBody | undefined),
          "only-if-unsent",
        ),
      command: async (uri) => await this.runTransport((client) => client.command(uri), "safe"),
    };
    if (config.localHostname && process.env["NODE_TLS_REJECT_UNAUTHORIZED"] !== "0") {
      this.log.warn(
        `Local Tydom fallback hostname=${styleString(
          config.localHostname,
        )} is configured but NODE_TLS_REJECT_UNAUTHORIZED is not set to 0; its self-signed certificate may be rejected`,
      );
    }
  }
  /**
   * Build a client for `password` and wire its events up.
   *
   * Split out of the constructor because account-derived credentials only
   * arrive once `connect` has been able to await the account API, and the
   * client takes its password at construction time.
   */
  private createClientForTarget(target: ConnectionTarget): TydomClient {
    const { username } = this.config;
    this.log.info(
      `Creating ${target.type} tydom client with username=${styleString(username)} and hostname=${styleString(
        target.hostname,
      )}`,
    );
    const client = this.clientFactory({
      username,
      password: this.gatewayPassword,
      hostname: target.hostname,
      followUpDebounce: 500,
      // A client which may be abandoned for another hostname must not keep an
      // inaccessible reconnect timer alive behind the controller's back.
      retryOnClose: !this.managedFallback,
    });
    client.on("message", (message: TydomHttpMessage) => {
      if (this.disposed || client !== this.client) {
        return;
      }
      try {
        this.handleMessage(message);
      } catch (err) {
        this.log.error(
          `Encountered an uncaught error=${stringifyError(err as Error)} while processing message=${styleJson(message)}"`,
        );
      }
    });
    client.on("connect", () => {
      // Managed clients are activated only after their explicit /ping succeeds.
      // Their socket emits `connect` before that handshake has completed.
      if (this.disposed || this.managedFallback || client !== this.client) {
        return;
      }
      this.connected = true;
      this.log.info(
        `Successfully connected to Tydom hostname=${styleString(target.hostname)} with username=${styleString(username)}`,
      );
      if (this.hasConnectedOnce) {
        this.log.warn(
          `Reconnected to Tydom hostname=${styleString(target.hostname)}, re-syncing state...`,
        );
        this.resync().catch((err: unknown) => {
          this.log.error(`Failed to re-sync after reconnection: ${stringifyError(err as Error)}`);
        });
      }
      this.emit("connect");
    });
    client.on("disconnect", () => {
      if (client !== this.client) {
        return;
      }
      this.connected = false;
      if (this.disposed) {
        return;
      }
      this.log.warn(`Disconnected from Tydom hostname=${styleString(target.hostname)}`);
      this.clearRefreshInterval();
      this.clearPrimaryRetryTimeout();
      this.emit("disconnect");
      if (this.managedFallback) {
        this.scheduleReconnect();
      }
    });
    return client;
  }
  /**
   * Fetch the gateway password from the Delta Dore account, once.
   *
   * No-op unless an account e-mail was configured. The result is kept for the
   * process lifetime: the gateway password is stable, and `connect` is retried
   * with backoff on startup — re-running the whole OAuth flow on every attempt
   * would turn a flaky socket into repeated sign-ins.
   */
  private async resolveGatewayPassword(): Promise<void> {
    const { email, password: accountPassword, username } = this.config;
    if (this.gatewayPassword || !email) {
      return;
    }
    this.log.info(
      `Resolving the gateway password from the Delta Dore account of ${styleString(maskEmail(email))}...`,
    );
    const password = await this.gatewayPasswordResolver({
      email,
      password: accountPassword,
      mac: username,
    });
    this.gatewayPassword = password;
    // The client takes its password at construction, so the placeholder built
    // in the constructor has to be replaced rather than reconfigured. Nothing
    // has connected yet, so there is no socket to migrate — only listeners.
    this.retireClient(this.client);
    this.activeTarget = { hostname: this.config.hostname, type: "primary" };
    this.client = this.createClientForTarget(this.activeTarget);
    this.initialClientAvailable = true;
    this.log.info(`Resolved the gateway password for username=${styleString(username)}`);
  }
  /** Whether a socket is up, however it got there. */
  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    const { hostname, username } = this.config;
    debug(`Connecting to hostname=${styleString(hostname)}...`);
    // Outside the try below, and before the socket: a rejected account
    // credential is not a failure to reach the gateway, and reporting it as one
    // hides the only thing the user can act on. `didFinishLaunching` recognises
    // `DeltaDoreAuthError` and stops rather than retrying it.
    await this.resolveGatewayPassword();
    try {
      if (this.managedFallback) {
        await this.startManagedTransition(false);
        return;
      }
      await this.client.connect();
      await asyncWait(250);
      // Initial intro handshake
      await this.client.get("/ping");
      this.hasConnectedOnce = true;
      // await asyncWait(250);
      // await this.client.put('/configs/gateway/api_mode');
    } catch (err) {
      this.log.error(`Failed to connect to Tydom hostname=${hostname} with username="${username}"`);
      throw err;
    }
  }

  private get currentHostname(): string {
    return this.activeTarget.hostname;
  }

  private connectionTargets(preferLocal: boolean): ConnectionTarget[] {
    const primary: ConnectionTarget = { hostname: this.config.hostname, type: "primary" };
    const localHostname = this.config.localHostname;
    if (!localHostname) {
      return [primary];
    }
    const local: ConnectionTarget = { hostname: localHostname, type: "local" };
    return preferLocal ? [local, primary] : [primary, local];
  }

  /**
   * Run one hostname transition at a time.
   *
   * The ordinary, single-host setup never reaches this path and keeps
   * tydom-client's automatic reconnect behaviour unchanged. With a fallback,
   * the controller is the sole retry owner so a retired primary cannot open a
   * second socket after the local client has taken over.
   */
  private async startManagedTransition(preferLocal: boolean): Promise<void> {
    if (this.disposed) {
      throw new Error("Tydom controller is disposed");
    }
    if (this.transitionPromise) {
      return this.transitionPromise;
    }
    this.clearReconnectTimeout();
    const run = this.connectToFirstAvailableTarget(this.connectionTargets(preferLocal));
    this.transitionPromise = run;
    try {
      await run;
    } finally {
      if (this.transitionPromise === run) {
        this.transitionPromise = undefined;
      }
    }
  }

  private async connectToFirstAvailableTarget(targets: ConnectionTarget[]): Promise<void> {
    let lastError: unknown;
    for (const target of targets) {
      try {
        await this.connectToTarget(target);
        return;
      } catch (err) {
        lastError = err;
        this.log.warn(
          `Failed to connect to ${target.type} Tydom hostname=${styleString(target.hostname)}: ${stringifyError(
            err as Error,
          )}`,
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Failed to connect to any Tydom hostname");
  }

  private async connectToTarget(target: ConnectionTarget): Promise<void> {
    debug(`Connecting to ${target.type} hostname=${styleString(target.hostname)}...`);
    const canUseInitialClient =
      this.initialClientAvailable &&
      target.type === this.activeTarget.type &&
      target.hostname === this.activeTarget.hostname;
    const candidate = canUseInitialClient ? this.client : this.createClientForTarget(target);
    this.initialClientAvailable = false;
    this.transitionClient = candidate;
    try {
      await candidate.connect();
      await asyncWait(250);
      await candidate.get("/ping");
      if (this.disposed) {
        throw new Error("Tydom controller was disposed while connecting");
      }
      this.activateManagedClient(candidate, target);
    } catch (err) {
      this.retireClient(candidate);
      throw err;
    } finally {
      if (this.transitionClient === candidate) {
        this.transitionClient = undefined;
      }
    }
  }

  private activateManagedClient(client: TydomClient, target: ConnectionTarget): void {
    const previousClient = this.client;
    const reconnecting = this.hasConnectedOnce;
    this.client = client;
    this.activeTarget = target;
    this.connected = true;
    this.hasConnectedOnce = true;
    this.reconnectAttempt = 0;
    this.clearReconnectTimeout();
    if (target.type === "local") {
      this.schedulePrimaryRetry();
    } else {
      this.clearPrimaryRetryTimeout();
    }
    if (previousClient !== client) {
      this.retireClient(previousClient);
    }
    this.log.info(
      `Successfully connected to ${target.type} Tydom hostname=${styleString(
        target.hostname,
      )} with username=${styleString(this.config.username)}`,
    );
    if (reconnecting) {
      this.log.warn(
        `Reconnected to Tydom hostname=${styleString(target.hostname)}, re-syncing state...`,
      );
      void this.resync().catch((err: unknown) => {
        this.log.error(`Failed to re-sync after reconnection: ${stringifyError(err as Error)}`);
      });
    }
    this.emit("connect");
  }

  private async runTransport<T>(
    operation: (client: TydomClient) => Promise<T>,
    retry: TransportRetry,
  ): Promise<T> {
    if (this.managedFallback && (!this.connected || this.transitionPromise)) {
      await this.startManagedTransition(true);
    }
    const client = this.client;
    try {
      return await operation(client);
    } catch (err) {
      if (!this.managedFallback) {
        throw err;
      }

      // The request may have started just before another caller completed the
      // transition. Reads can move to the new socket; ambiguous writes cannot.
      if (client !== this.client) {
        if (retry === "safe" || (retry === "only-if-unsent" && this.wasDefinitelyNotSent(err))) {
          return await operation(this.client);
        }
        throw err;
      }

      if (this.connected && !this.isTransportFailure(err)) {
        throw err;
      }
      this.connected = false;
      this.clearRefreshInterval();
      try {
        await this.startManagedTransition(true);
      } catch {
        this.scheduleReconnect();
        throw err;
      }
      if (retry === "safe" || (retry === "only-if-unsent" && this.wasDefinitelyNotSent(err))) {
        return await operation(this.client);
      }
      throw err;
    }
  }

  private isTransportFailure(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /Required socket instance|Socket instance is closing\/closed|Socket closed while request was pending|Request timed out|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed/i.test(
      message,
    );
  }

  /** Errors raised before `socket.send`, for which replay cannot duplicate an action. */
  private wasDefinitelyNotSent(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /Required socket instance|Socket instance is closing\/closed/i.test(message);
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.managedFallback || this.connected || this.transitionPromise) {
      return;
    }
    this.clearReconnectTimeout();
    this.reconnectAttempt += 1;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempt - 1),
      MAX_RECONNECT_DELAY_MS,
    );
    this.log.warn(`Reconnecting to Tydom in ${Math.round(delay / 1000)}s...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      void this.startManagedTransition(true).catch((err: unknown) => {
        this.log.error(`Failed to reconnect to Tydom: ${stringifyError(err as Error)}`);
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimeout.unref?.();
  }

  private schedulePrimaryRetry(): void {
    if (
      this.disposed ||
      !this.connected ||
      this.activeTarget.type !== "local" ||
      this.primaryProbeClient
    ) {
      return;
    }
    this.clearPrimaryRetryTimeout();
    this.primaryRetryTimeout = setTimeout(() => {
      this.primaryRetryTimeout = undefined;
      void this.tryRestorePrimary().catch((err: unknown) => {
        this.log.warn(
          `Failed to restore primary Tydom hostname=${styleString(
            this.config.hostname,
          )}: ${stringifyError(err as Error)}`,
        );
        this.schedulePrimaryRetry();
      });
    }, this.config.primaryRetryIntervalMs);
    this.primaryRetryTimeout.unref?.();
  }

  private async tryRestorePrimary(): Promise<void> {
    if (this.disposed || !this.connected || this.activeTarget.type !== "local") {
      return;
    }
    const localClient = this.client;
    const target: ConnectionTarget = { hostname: this.config.hostname, type: "primary" };
    const candidate = this.createClientForTarget(target);
    this.primaryProbeClient = candidate;
    let activated = false;
    try {
      this.log.info(
        `Checking if primary Tydom hostname=${styleString(target.hostname)} is available again...`,
      );
      await candidate.connect();
      await asyncWait(250);
      await candidate.get("/ping");
      if (
        this.disposed ||
        !this.connected ||
        this.client !== localClient ||
        this.activeTarget.type !== "local"
      ) {
        return;
      }
      activated = true;
      this.primaryProbeClient = undefined;
      this.activateManagedClient(candidate, target);
      this.log.warn(
        `Restored primary Tydom hostname=${styleString(target.hostname)}, switching back from local fallback`,
      );
    } finally {
      if (this.primaryProbeClient === candidate) {
        this.primaryProbeClient = undefined;
      }
      if (!activated) {
        this.retireClient(candidate);
      }
    }
  }

  private clearRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
  }

  private clearPrimaryRetryTimeout(): void {
    if (this.primaryRetryTimeout) {
      clearTimeout(this.primaryRetryTimeout);
      this.primaryRetryTimeout = undefined;
    }
  }

  private retireClient(client: TydomClient): void {
    try {
      client.removeAllListeners();
      client.close();
    } catch (err) {
      debug(`Ignoring error while closing a Tydom client: ${String(err)}`);
    }
  }

  async sync(): Promise<{
    config: TydomConfigResponse;
    groups: TydomGroupsResponse;
    meta: TydomMetaResponse;
  }> {
    debug(`Syncing state from hostname=${styleString(this.currentHostname)}...`);
    // Checked rather than cast: everything downstream assumes these shapes, and
    // an unnoticed change here would surface as a TypeError deep inside
    // discovery instead of naming the endpoint that actually moved.
    const config = parseDiscoveryResponse(
      "/configs/file",
      tydomConfigResponseSchema,
      await this.transport.get("/configs/file"),
    );
    const groups = parseDiscoveryResponse(
      "/groups/file",
      tydomGroupsResponseSchema,
      await this.transport.get("/groups/file"),
    );
    const meta = parseDiscoveryResponse(
      "/devices/meta",
      tydomMetaResponseSchema,
      await this.transport.get("/devices/meta"),
    );
    // Final outro handshake
    await this.refresh();
    this.scheduleRefresh();
    return { config, groups, meta };
  }
  async scan(): Promise<void> {
    const { username, settings = {} } = this.config;
    this.log.info(`Scanning devices from hostname=${styleString(this.currentHostname)}...`);
    const { config, groups, meta } = await this.sync();

    const { devices, skipped } = discoverDevices({
      username,
      config,
      groups,
      meta,
      settings,
      filters: {
        includedDevices: this.config.includedDevices,
        excludedDevices: this.config.excludedDevices,
        includedCategories: this.config.includedCategories,
        excludedCategories: this.config.excludedCategories,
      },
    });

    for (const skip of skipped) {
      if (skip.reason === "unsupported") {
        this.log.warn(
          `Unsupported firstUsage="${skip.firstUsage}" for endpoint with deviceId="${skip.deviceId}"`,
        );
      }
    }

    for (const device of devices.flatMap((d) => expandCompanions(d))) {
      const { uniqueId, deviceId, endpointId, firstUsage, category } = device;
      this.log.info(
        `Found new device with firstUsage=${styleString(firstUsage)}, deviceId=${styleNumber(
          deviceId,
        )} and endpointId=${styleNumber(endpointId)}`,
      );
      if (this.emitted.has(device.accessoryId)) {
        continue;
      }
      this.emitted.add(device.accessoryId);
      this.log.info(
        `Adding new device with firstUsage=${styleString(firstUsage)}, deviceId=${styleNumber(
          deviceId,
        )} and endpointId=${styleNumber(endpointId)}`,
      );
      // A companion carries a synthetic category that must not overwrite the
      // real one its primary registered for the same endpoint.
      if (!device.companionOf) {
        this.devices.set(uniqueId, category as Categories);
      }
      const context: TydomAccessoryContext = {
        name:
          device.deviceType === "alarm-sensors"
            ? this.t("ALARME_ISSUES_OUVERTES", device.name)
            : device.name,
        category: category as Categories,
        deviceType: device.deviceType,
        metadata: device.metadata,
        settings: device.settings,
        group: device.group,
        deviceId,
        endpointId,
        accessoryId: device.accessoryId,
        ...(device.companionOf ? { companionOf: device.companionOf } : {}),
        manufacturer: "Delta Dore",
        serialNumber: `ID${deviceId}`,
        state: {},
      };
      this.emit("device", context);
    }
  }
  async refresh(): Promise<void> {
    debug(`Refreshing Tydom controller ...`);
    await this.transport.post("/refresh/all");
  }
  /**
   * (Re-)install the periodic full refresh.
   *
   * One method rather than a copy in each of `sync` and `resync`: the two had
   * drifted, and the reconnect copy had lost the `unref` — so a bridge that had
   * reconnected once could no longer exit on its own.
   */
  private scheduleRefresh(): void {
    const { refreshIntervalMs } = this.config;
    if (this.refreshInterval) {
      debug(`Removing existing refresh interval`);
      clearInterval(this.refreshInterval);
    }
    debug(`Configuring refresh interval of ${styleNumber(Math.round(refreshIntervalMs / 1000))}s`);
    this.refreshInterval = setInterval(() => {
      this.refresh().catch((err: unknown) => {
        // Warn rather than debug: a gateway that has quietly stopped accepting
        // refreshes leaves every reading to go stale, and that is invisible in
        // a normal log if it only ever reaches the debug sink.
        this.log.warn(`Failed interval refresh: ${stringifyError(err as Error)}`);
      });
    }, refreshIntervalMs);
    this.refreshInterval.unref?.();
  }
  /**
   * Re-sync after a reconnection, one at a time.
   *
   * A flapping socket emits `connect` repeatedly, and each one used to start
   * its own resync: several `/ping`s and `/refresh/all`s in flight together,
   * every one of them re-arming the interval the last had just installed. The
   * run in progress is not joined but followed, because a resync that began
   * before the newest reconnection queried the socket that has since gone.
   */
  private async resync(): Promise<void> {
    if (this.resyncing) {
      this.pendingResync = true;
      return this.resyncing;
    }
    const run = (async () => {
      do {
        this.pendingResync = false;
        await this.runResync();
      } while (this.pendingResync && !this.disposed);
    })();
    this.resyncing = run;
    try {
      await run;
    } finally {
      this.resyncing = undefined;
    }
  }

  private async runResync(): Promise<void> {
    debug(
      `Re-syncing state after reconnection to hostname=${styleString(this.currentHostname)}...`,
    );
    await asyncWait(250);
    if (this.disposed) {
      return;
    }
    await this.transport.get("/ping");
    await this.refresh();
    if (this.disposed) {
      return;
    }
    // Re-establish the refresh interval, which the disconnect handler cleared.
    this.scheduleRefresh();
  }

  /**
   * Stop the refresh timer and close the socket. Idempotent.
   *
   * Listeners come off before the close: `client.close()` triggers the socket's
   * own `close` handler, which reconnects. See `disposed` for why that cannot
   * be prevented from here — detaching first is what stops the reconnection
   * from re-arming timers and pushing state into handlers that are gone.
   */
  dispose(): void {
    this.disposed = true;
    this.connected = false;
    this.clearRefreshInterval();
    this.clearReconnectTimeout();
    this.clearPrimaryRetryTimeout();
    if (this.primaryProbeClient) {
      this.retireClient(this.primaryProbeClient);
      this.primaryProbeClient = undefined;
    }
    if (this.transitionClient && this.transitionClient !== this.client) {
      this.retireClient(this.transitionClient);
      this.transitionClient = undefined;
    }
    this.retireClient(this.client);
  }

  handleMessage(message: TydomHttpMessage): void {
    const { uri, method, body } = message;
    const type = classifyMessage(uri, method);
    if (type === "unknown") {
      debug(`Unknown message from Tydom client:\n${styleJson(message)}`);
      return;
    }
    this.handleDeviceDataUpdate(body, type);
  }

  handleDeviceDataUpdate(body: TydomResponse, type: TydomUpdateType): void {
    for (const update of parseDeviceDataUpdate(body, type)) {
      const { deviceId, endpointId, updates } = update;
      const uniqueId = getUniqueId(deviceId, endpointId);
      const category = this.devices.get(uniqueId);
      if (category === undefined) {
        debug(
          `${styleUpd("\u2190PUT")}:${styleKeyword("ignored")} for device id=${styleString(
            deviceId,
          )} and endpointId=${styleNumber(endpointId)}`,
        );
        continue;
      }
      debug(
        `${styleGet("\u2190PUT")}:${styleKeyword("update")} for deviceId=${styleNumber(
          deviceId,
        )} and endpointId=${styleNumber(endpointId)}, updates:\n${styleJson(updates)}`,
      );
      const context: TydomAccessoryUpdateContext = {
        category,
        deviceId,
        endpointId,
        accessoryId: getAccessoryId(this.config.username, deviceId, endpointId),
      };
      this.emit("update", { type, updates, context } as ControllerUpdatePayload);
    }
  }
}
