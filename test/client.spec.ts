import { describe, expect, it, vi } from "vitest";
import { TydomApiClient, type TydomTransport } from "../src/api/client.js";
import { UnreachableDeviceError } from "../src/api/errors.js";
import { createTestLogger } from "./helpers.js";

type Get = TydomTransport["get"];
type Put = TydomTransport["put"];
type Post = TydomTransport["post"];
type Command = TydomTransport["command"];

const createTransport = (overrides: Partial<TydomTransport> = {}): TydomTransport => ({
  get: vi.fn<Get>(async () => ({ error: 0, data: [] })),
  put: vi.fn<Put>(async () => ({})),
  post: vi.fn<Post>(async () => ({})),
  command: vi.fn<Command>(async () => []),
  ...overrides,
});

/** cacheWindowMs 0 so each test opts into caching explicitly. */
const createClient = (overrides: Partial<TydomTransport> = {}) => {
  const transport = createTransport(overrides);
  const logger = createTestLogger();
  return {
    transport,
    logger,
    client: new TydomApiClient({ transport, logger, cacheWindowMs: 0 }),
  };
};

describe("TydomApiClient URIs", () => {
  it("builds the data URI", () => {
    expect(TydomApiClient.dataUri(1, 2)).toBe("/devices/1/endpoints/2/data");
  });

  it("builds the command URI, with and without search params", () => {
    expect(TydomApiClient.commandUri(1, 2, "label")).toBe(
      "/devices/1/endpoints/2/cdata?name=label",
    );
    expect(TydomApiClient.commandUri(1, 2, "histo", { indexStart: "0", nbElem: "10" })).toBe(
      "/devices/1/endpoints/2/cdata?name=histo&indexStart=0&nbElem=10",
    );
  });

  it("encodes search param values", () => {
    expect(TydomApiClient.commandUri(1, 2, "x", { q: "a b&c" })).toContain("q=a+b%26c");
  });
});

describe("getDeviceData", () => {
  it("unwraps the data envelope", async () => {
    const { client } = createClient({
      get: vi.fn<Get>(async () => ({ error: 0, data: [{ name: "level", value: 50 }] })),
    });
    await expect(client.getDeviceData(1, 2)).resolves.toEqual([{ name: "level", value: 50 }]);
  });

  it("passes through firmware that answers with the bare array", async () => {
    const bare = [{ name: "level", value: 10 }];
    const { client } = createClient({ get: vi.fn<Get>(async () => bare) });
    await expect(client.getDeviceData(1, 2)).resolves.toEqual(bare);
  });

  it("throws UnreachableDeviceError above the error threshold", async () => {
    const { client } = createClient({
      get: vi.fn<Get>(async () => ({ error: 11, data: [] })),
    });
    await expect(client.getDeviceData(1, 2)).rejects.toBeInstanceOf(UnreachableDeviceError);
  });

  it("tolerates a low non-zero error and still returns the data", async () => {
    // Several devices report a non-fatal code alongside perfectly good data;
    // the released behaviour was to log and carry on.
    const { client, logger } = createClient({
      get: vi.fn<Get>(async () => ({ error: 3, data: [{ name: "level", value: 1 }] })),
    });
    await expect(client.getDeviceData(1, 2)).resolves.toEqual([{ name: "level", value: 1 }]);
    expect(logger.messages.some((m) => m.includes("non-zero error=3"))).toBe(true);
  });

  it("deduplicates concurrent reads when a cache window is configured", async () => {
    const get = vi.fn<Get>(async () => ({ error: 0, data: [] }));
    const client = new TydomApiClient({
      transport: createTransport({ get }),
      logger: createTestLogger(),
      cacheWindowMs: 1000,
    });
    await Promise.all([client.getDeviceData(1, 2), client.getDeviceData(1, 2)]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("does not share a cache between two client instances", async () => {
    // The released version kept this Map at module scope, so two Tydom
    // platforms in one Homebridge process shared — and evicted — each other's
    // reads.
    const get = vi.fn<Get>(async () => ({ error: 0, data: [] }));
    const transport = createTransport({ get });
    const logger = createTestLogger();
    const a = new TydomApiClient({ transport, logger, cacheWindowMs: 1000 });
    const b = new TydomApiClient({ transport, logger, cacheWindowMs: 1000 });
    await a.getDeviceData(1, 2);
    await b.getDeviceData(1, 2);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("writes", () => {
  it("puts endpoint data without caching", async () => {
    const put = vi.fn<Put>(async () => ({}));
    const { client } = createClient({ put });
    await client.putDeviceData(1, 2, [{ name: "level", value: 100 }]);
    await client.putDeviceData(1, 2, [{ name: "level", value: 100 }]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledWith("/devices/1/endpoints/2/data", [
      { name: "level", value: 100 },
    ]);
  });

  it("puts a command body to the cdata URI", async () => {
    const put = vi.fn<Put>(async () => ({}));
    const { client } = createClient({ put });
    await client.putCommand(1, 2, "zoneCmd", { value: "ON", zones: [1] });
    expect(put).toHaveBeenCalledWith("/devices/1/endpoints/2/cdata?name=zoneCmd", {
      value: "ON",
      zones: [1],
    });
  });

  it("runs commands through the transport", async () => {
    const command = vi.fn<Command>(async () => [{ zones: [] }]);
    const { client } = createClient({ command });
    await expect(client.runCommand(1, 2, "label")).resolves.toEqual([{ zones: [] }]);
    expect(command).toHaveBeenCalledWith("/devices/1/endpoints/2/cdata?name=label");
  });
});
