import { RequestCache } from "./cache.js";
import { RequestPacer } from "./pacer.js";
import { TydomApiError, UnreachableDeviceError } from "./errors.js";
import type { TydomEndpointData, TydomEndpointDataResponse } from "./types.js";

/**
 * A minimal, structural logger.
 *
 * `src/api` must not import from `homebridge`, so it depends on this shape
 * rather than on Homebridge's `Logging`. The platform supplies an adapter.
 */
export type PluginLogger = {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

/**
 * The slice of `tydom-client` this plugin actually uses.
 *
 * This is the dependency-injection seam. tydom-client speaks HTTP-shaped frames
 * tunnelled over a WebSocket after a digest handshake, which no HTTP mocking
 * library can intercept — so tests substitute a fake transport here instead, and
 * the wire-level behaviour is covered in tydom-client's own suite.
 */
export type TydomTransport = {
  get(uri: string): Promise<unknown>;
  put(uri: string, body?: unknown): Promise<unknown>;
  post(uri: string, body?: unknown): Promise<unknown>;
  command(uri: string): Promise<unknown[]>;
};

/** Below this, a non-zero `error` is a quirk worth logging but not throwing on. */
const UNREACHABLE_THRESHOLD = 10;

export const DEFAULT_CACHE_WINDOW_MS = 1_000;

/**
 * Smallest gap between two request starts.
 *
 * Small on purpose. This is a burst ceiling, not a throttle: at 25 ms a
 * fifty-device refresh is spread over about a second, which the gateway copes
 * with and HomeKit does not notice, while a scene firing a dozen commands in one
 * tick no longer arrives as a dozen simultaneous frames. No specific gateway
 * failure prompted this — it is a bound on a burst nothing else bounds.
 */
export const DEFAULT_REQUEST_INTERVAL_MS = 25;

export type TydomApiClientOptions = {
  transport: TydomTransport;
  logger: PluginLogger;
  /** How long a read stays fresh. Tests pass 0. */
  cacheWindowMs?: number;
  /** Smallest gap between request starts. Tests pass 0. */
  requestIntervalMs?: number;
};

export class TydomApiClient {
  readonly #transport: TydomTransport;
  readonly #logger: PluginLogger;
  readonly #cache: RequestCache;
  readonly #pacer: RequestPacer;

  constructor(options: TydomApiClientOptions) {
    this.#transport = options.transport;
    this.#logger = options.logger;
    this.#cache = new RequestCache(options.cacheWindowMs ?? DEFAULT_CACHE_WINDOW_MS);
    this.#pacer = new RequestPacer(options.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS);
  }

  static dataUri(deviceId: number, endpointId: number): string {
    return `/devices/${deviceId}/endpoints/${endpointId}/data`;
  }

  static commandUri(
    deviceId: number,
    endpointId: number,
    name: string,
    searchParams?: Record<string, string>,
  ): string {
    const extra = searchParams ? `&${new URLSearchParams(searchParams).toString()}` : "";
    return `/devices/${deviceId}/endpoints/${endpointId}/cdata?name=${name}${extra}`;
  }

  /** Read an endpoint's current data, collapsing duplicate concurrent reads. */
  async getDeviceData<T extends TydomEndpointData = TydomEndpointData>(
    deviceId: number,
    endpointId: number,
  ): Promise<T> {
    const uri = TydomApiClient.dataUri(deviceId, endpointId);
    return this.#cache.run(uri, async () => {
      const res = (await this.#pacer.run(() =>
        this.#transport.get(uri),
      )) as TydomEndpointDataResponse;
      this.#assertOk(uri, res.error);
      // Some firmware answers with the bare data array rather than an envelope.
      return (res.data ? res.data : res) as unknown as T;
    });
  }

  /** Write values to an endpoint. Not cached — writes are never deduplicated. */
  async putDeviceData(
    deviceId: number,
    endpointId: number,
    values: { name: string; value: unknown }[],
  ): Promise<void> {
    await this.#pacer.run(() =>
      this.#transport.put(TydomApiClient.dataUri(deviceId, endpointId), values),
    );
  }

  /** Run a device command (`cdata`), collapsing duplicate concurrent runs. */
  async runCommand<T extends Record<string, unknown> = Record<string, unknown>>(
    deviceId: number,
    endpointId: number,
    name: string,
    searchParams?: Record<string, string>,
  ): Promise<T[]> {
    const uri = TydomApiClient.commandUri(deviceId, endpointId, name, searchParams);
    return this.#cache.run(
      uri,
      async () => (await this.#pacer.run(() => this.#transport.command(uri))) as T[],
    );
  }

  /** Issue a device command that carries a body (arming, zone changes). */
  async putCommand(
    deviceId: number,
    endpointId: number,
    name: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.#pacer.run(() =>
      this.#transport.put(TydomApiClient.commandUri(deviceId, endpointId, name), body),
    );
  }

  async get<T>(uri: string): Promise<T> {
    return (await this.#pacer.run(() => this.#transport.get(uri))) as T;
  }

  async post<T>(uri: string, body?: unknown): Promise<T> {
    return (await this.#pacer.run(() => this.#transport.post(uri, body))) as T;
  }

  #assertOk(uri: string, code: number | undefined): void {
    if (!code || code <= 0) {
      return;
    }
    if (code > UNREACHABLE_THRESHOLD) {
      this.#logger.debug(`Device at ${uri} seems unreachable (error=${code})`);
      throw new UnreachableDeviceError(uri, code);
    }
    // Historically these were logged and the data used anyway; keeping that,
    // because several devices report a non-fatal code alongside good data.
    this.#logger.debug(`${uri} reported a non-zero error=${code}, using the data anyway`);
  }
}

export { TydomApiError };
