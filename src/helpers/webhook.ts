/** How long a webhook may take before we stop waiting on it. */
const REQUEST_TIMEOUT_MS = 10_000;

export type Webhook = {
  url: string;
  // level: string;
  type: string;
};
export type WebhookPayload = {
  message: string;
  level?: string;
};

/**
 * A notification on its way to the webhooks.
 *
 * `level` is required here but optional on `WebhookPayload`: everything that
 * raises a notification states a level, and only `triggerWebhook` itself
 * defaults it.
 */
export type NotificationPayload = Required<WebhookPayload>;

type DiscordPayload = {
  content: string; //	the message contents (up to 2000 characters)	one of content, file, embeds
  username?: string; //	override the default username of the webhook	false
  avatar_url?: string; //	override the default avatar of the webhook	false
  tts?: boolean; //	true if this is a TTS message	false
  // file	file contents	the contents of the file being sent	one of content, file, embeds
  // embeds	array of up to 10 embed objects	embedded rich content	one of content, file, embeds
  payload_json?: string; //	See message create	multipart/form-data only
  allowed_mentions?: boolean; //	allowed mention object	allowed mentions for the message	false
};

export const asDiscordPayload = ({ level, message }: WebhookPayload): DiscordPayload => {
  let prefix = "";
  switch (level) {
    case "warn":
      prefix = ":warning: ";
      break;
    default:
      prefix = ":question: ";
      break;
  }
  return {
    content: `${prefix}${message}`,
  };
};

/** Injected in tests; `fetch` is global from Node 18 on and the engines floor is 22. */
export type FetchLike = typeof globalThis.fetch;

/**
 * Post a webhook.
 *
 * `fetch` rather than the hand-rolled `node:https` helper this replaces, which
 * had three faults a webhook carrying an accented device name would hit: it set
 * `Content-Length` from string length rather than byte length, it dropped the
 * query string a Discord webhook URL can carry, and it parsed the response
 * inside an `end` handler — outside the promise's frame, so a non-JSON error
 * page threw an uncaught exception and took the bridge down with it.
 *
 * The response body is never read: nothing here acts on it, and not reading it
 * removes the only reason to parse.
 */
export const triggerWebhook = async (
  webhook: Webhook,
  { message, level = "info" }: WebhookPayload,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<void> => {
  const { url, type } = webhook;
  switch (type) {
    case "discord": {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(asDiscordPayload({ message, level })),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Webhook to ${new URL(url).host} failed with status ${response.status}`);
      }
      break;
    }
    default:
      break;
  }
};
