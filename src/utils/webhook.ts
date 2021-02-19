import {postJson} from './request';

export type Webhook = {
  url: string;
  // level: string;
  type: string;
};
export type WebhookPayload = {
  message: string;
  level?: string;
};

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

export const asDiscordPayload = ({level, message}: WebhookPayload): DiscordPayload => ({
  content: `[${level}] ${message}`
});

export const triggerWebhook = async (webhook: Webhook, {message, level = 'info'}: WebhookPayload): Promise<void> => {
  const {url, type} = webhook;
  switch (type) {
    case 'discord':
      const res = await postJson({url, json: asDiscordPayload({message, level})});
      console.dir({res});
      break;
    default:
      break;
  }
};
