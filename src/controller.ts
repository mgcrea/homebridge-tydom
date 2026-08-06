import { EventEmitter } from "node:events";
import type { Logging } from "homebridge";
import type { Categories } from "homebridge";
import { blue, bold, green, yellow } from "kolorist";
import { createTranslator, type Translator } from "./i18n/index.js";
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
import { styleJson, styleNumber, styleString } from "./util/style.js";
import { debug } from "./platform/trace.js";
import { stringifyError } from "./util/error.js";
import { resolveGatewayPassword } from "./util/deltadore.js";
import { maskEmail } from "./util/redact.js";
import type TydomClient from "tydom-client";
import {
  createClient as createTydomClient,
  type TydomHttpMessage,
  type TydomResponse,
} from "tydom-client";

export type ControllerDevicePayload = TydomAccessoryContext;

export type ControllerUpdatePayload = {
  type: TydomAccessoryUpdateType;
  category: Categories;
  updates: Record<string, unknown>[];
  context: TydomAccessoryContext;
};

export default class TydomController extends EventEmitter {
  public client: TydomClient;
  public config: TydomPlatformConfig;
  public log: Logging;
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
  constructor(log: Logging, config: TydomPlatformConfig) {
    super();
    this.config = config;
    this.log = log;
    this.t = createTranslator(config.locale);
    // hostname/username/password are validated and resolved by parseConfig,
    // so there is nothing left to assert here.
    const { hostname, username, password, email } = config;
    this.log.info(
      `Creating tydom client with username=${styleString(username)} and hostname=${styleString(hostname)}`,
    );
    // With an e-mail configured, `password` belongs to the account rather than
    // the gateway, so the client starts out with no usable credential and
    // `connect` fills one in.
    this.gatewayPassword = email ? "" : password;
    this.client = this.createClient(this.gatewayPassword);
  }
  /**
   * Build a client for `password` and wire its events up.
   *
   * Split out of the constructor because account-derived credentials only
   * arrive once `connect` has been able to await the account API, and the
   * client takes its password at construction time.
   */
  private createClient(password: string): TydomClient {
    const { hostname, username } = this.config;
    const client = createTydomClient({ username, password, hostname, followUpDebounce: 500 });
    client.on("message", (message: TydomHttpMessage) => {
      try {
        this.handleMessage(message);
      } catch (err) {
        this.log.error(
          `Encountered an uncaught error=${stringifyError(err as Error)} while processing message=${styleJson(message)}"`,
        );
      }
    });
    client.on("connect", () => {
      if (this.disposed) {
        return;
      }
      this.connected = true;
      this.log.info(
        `Successfully connected to Tydom hostname=${styleString(hostname)} with username=${styleString(username)}`,
      );
      if (this.hasConnectedOnce) {
        this.log.warn(
          `Reconnected to Tydom hostname=${styleString(hostname)}, re-syncing state...`,
        );
        this.resync().catch((err: unknown) => {
          this.log.error(`Failed to re-sync after reconnection: ${stringifyError(err as Error)}`);
        });
      }
      this.emit("connect");
    });
    client.on("disconnect", () => {
      this.connected = false;
      if (this.disposed) {
        return;
      }
      this.log.warn(`Disconnected from Tydom hostname=${styleString(hostname)}`);
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = undefined;
      }
      this.emit("disconnect");
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
    const password = await resolveGatewayPassword({
      email,
      password: accountPassword,
      mac: username,
    });
    this.gatewayPassword = password;
    // The client takes its password at construction, so the placeholder built
    // in the constructor has to be replaced rather than reconfigured. Nothing
    // has connected yet, so there is no socket to migrate — only listeners.
    this.client.removeAllListeners();
    this.client = this.createClient(password);
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
  async sync(): Promise<{
    config: TydomConfigResponse;
    groups: TydomGroupsResponse;
    meta: TydomMetaResponse;
  }> {
    const { hostname } = this.config;
    debug(`Syncing state from hostname=${styleString(hostname)}...`);
    // Checked rather than cast: everything downstream assumes these shapes, and
    // an unnoticed change here would surface as a TypeError deep inside
    // discovery instead of naming the endpoint that actually moved.
    const config = parseDiscoveryResponse(
      "/configs/file",
      tydomConfigResponseSchema,
      await this.client.get("/configs/file"),
    );
    const groups = parseDiscoveryResponse(
      "/groups/file",
      tydomGroupsResponseSchema,
      await this.client.get("/groups/file"),
    );
    const meta = parseDiscoveryResponse(
      "/devices/meta",
      tydomMetaResponseSchema,
      await this.client.get("/devices/meta"),
    );
    // Final outro handshake
    await this.refresh();
    this.scheduleRefresh();
    return { config, groups, meta };
  }
  async scan(): Promise<void> {
    const { hostname, username, settings = {} } = this.config;
    this.log.info(`Scanning devices from hostname=${styleString(hostname)}...`);
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
    await this.client.post("/refresh/all");
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
    const { hostname } = this.config;
    debug(`Re-syncing state after reconnection to hostname=${styleString(hostname)}...`);
    await asyncWait(250);
    if (this.disposed) {
      return;
    }
    await this.client.get("/ping");
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
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
    try {
      this.client.removeAllListeners();
      this.client.close();
    } catch (err) {
      debug(`Ignoring error while closing the Tydom client: ${String(err)}`);
    }
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
          `${bold(yellow("\u2190PUT"))}:${blue("ignored")} for device id=${styleString(
            deviceId,
          )} and endpointId=${styleNumber(endpointId)}`,
        );
        continue;
      }
      debug(
        `${bold(green("\u2190PUT"))}:${blue("update")} for deviceId=${styleNumber(
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
