import { describe, expect, it } from "vitest";
import { asDiscordPayload, triggerWebhook, type FetchLike } from "../src/helpers/webhook.js";

/** Records what was sent and answers with `status`. */
const recordingFetch = (status = 204) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response(null, { status }));
  }) as FetchLike;
  return { fetchImpl, calls };
};

describe("asDiscordPayload", () => {
  it("prefixes a warning", () => {
    expect(asDiscordPayload({ level: "warn", message: "Alarme" }).content).toBe(":warning: Alarme");
  });

  it("falls back to a neutral prefix", () => {
    expect(asDiscordPayload({ level: "info", message: "Porte" }).content).toBe(":question: Porte");
  });
});

describe("triggerWebhook", () => {
  const webhook = { url: "https://discord.example/api/webhooks/1/abc", type: "discord" };

  it("posts the payload as JSON", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await triggerWebhook(webhook, { message: "Porte ouverte", level: "warn" }, fetchImpl);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.init?.method).toBe("POST");
    expect(JSON.parse(String(call?.init?.body))).toEqual({ content: ":warning: Porte ouverte" });
  });

  it("preserves the query string a webhook URL can carry", async () => {
    // The hand-rolled client this replaced passed only `pathname`, so a
    // `?thread_id=` or `?wait=true` was silently dropped.
    const { fetchImpl, calls } = recordingFetch();
    const threaded = {
      url: "https://discord.example/api/webhooks/1/abc?thread_id=42",
      type: "discord",
    };
    await triggerWebhook(threaded, { message: "Salon" }, fetchImpl);
    expect(calls[0]?.url).toContain("?thread_id=42");
  });

  it("sends an accented message intact", async () => {
    // `Content-Length` used to come from string length rather than byte length,
    // so anything non-ASCII under-reported and the request truncated or hung.
    // `fetch` computes it from the encoded body, which is the actual fix.
    const { fetchImpl, calls } = recordingFetch();
    await triggerWebhook(webhook, { message: "Alarme déclenchée", level: "warn" }, fetchImpl);
    const body = String(calls[0]?.init?.body);
    expect(JSON.parse(body).content).toBe(":warning: Alarme déclenchée");
    expect(Buffer.byteLength(body)).toBeGreaterThan(body.length);
  });

  it("rejects rather than throwing out of band when the webhook is refused", async () => {
    // The predecessor parsed the response inside an `end` handler, outside the
    // promise's frame, so a non-JSON error page threw an uncaught exception and
    // took the bridge down. A rejection is catchable by the caller.
    const { fetchImpl } = recordingFetch(404);
    await expect(triggerWebhook(webhook, { message: "Salon" }, fetchImpl)).rejects.toThrow(
      /status 404/,
    );
  });

  it("does not name the webhook secret in the failure", async () => {
    const { fetchImpl } = recordingFetch(500);
    await expect(triggerWebhook(webhook, { message: "Salon" }, fetchImpl)).rejects.not.toThrow(
      /abc/,
    );
  });

  it("ignores a webhook type it does not implement", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await triggerWebhook(
      { url: "https://example.com", type: "slack" },
      { message: "x" },
      fetchImpl,
    );
    expect(calls).toHaveLength(0);
  });
});
