import { z } from "zod";

/**
 * Delta Dore account API — turns account credentials into gateway credentials.
 *
 * The gateway's own digest handshake (`mediation/client`) authenticates with the
 * gateway MAC as the username and a *gateway* password that is neither the
 * account password nor anything printed on the box. Delta Dore's own apps fetch
 * it at runtime from the account API, which is what this module does.
 *
 * The flow is three hops:
 *
 *   1. OpenID discovery against Delta Dore's Azure AD B2C tenant, to find the
 *      token endpoint. Hard-coding it would break the day they rotate it, and
 *      discovery is the documented way to avoid that.
 *   2. A ROPC (`grant_type=password`) token grant — B2C's non-interactive flow,
 *      the only one usable from a headless plugin.
 *   3. `GET /sites?gateway_mac=…`, which returns the site and its gateway
 *      credentials.
 *
 * Note that step 3 *validates* a MAC rather than enumerating: there is no
 * public endpoint that lists an account's gateways, so the MAC stays a required
 * piece of configuration. Only the password is derived here.
 */

const AUTH_CONFIG_URL =
  "https://deltadoreadb2ciot.b2clogin.com/deltadoreadb2ciot.onmicrosoft.com/v2.0/.well-known/openid-configuration?p=B2C_1_AccountProviderROPC_SignIn";

/** The Tydom mobile app's public client id. Not a secret. */
const CLIENT_ID = "8782839f-3264-472a-ab87-4d4e23524da4";

const SITES_URL = "https://prod.iotdeltadore.com/sitesmanagement/api/v1/sites";

/**
 * Only the two scopes this actually needs.
 *
 * The app requests twenty-odd (video, metering, orchestration...); asking for
 * scopes we never exercise would hand the token far more authority than reading
 * one gateway password warrants.
 */
const SCOPE = [
  "openid",
  "profile",
  "offline_access",
  "https://deltadoreadb2ciot.onmicrosoft.com/iotapi/sites_management_allowed",
  "https://deltadoreadb2ciot.onmicrosoft.com/iotapi/sites_management_gateway_credentials",
].join(" ");

/** How long any one hop may take before we stop waiting on Delta Dore. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A credential problem the user has to fix, as opposed to a transport blip.
 *
 * Kept distinct so the platform can say "your account password is wrong" rather
 * than burning ten connection retries on something no retry will fix.
 */
export class DeltaDoreAuthError extends Error {
  override readonly name = "DeltaDoreAuthError";
}

const openIdConfigSchema = z.object({ token_endpoint: z.string() }).loose();

const tokenResponseSchema = z.object({ access_token: z.string() }).loose();

const tokenErrorSchema = z
  .object({ error: z.string().optional(), error_description: z.string().optional() })
  .loose();

const siteSchema = z
  .object({
    id: z.string().optional(),
    gateway: z
      .object({ mac: z.string().optional(), password: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();

const sitesResponseSchema = z.object({ sites: z.array(siteSchema).default([]) }).loose();

/** Injected in tests; `fetch` is global from Node 18 on and the engines floor is 22. */
export type FetchLike = typeof globalThis.fetch;

export type ResolveGatewayPasswordOptions = {
  email: string;
  password: string;
  /** The gateway MAC. Normalised before it goes on the wire. */
  mac: string;
  fetch?: FetchLike;
};

/**
 * Uppercase, separators stripped — the form the sites API matches on.
 *
 * Users copy the MAC off the label underneath the box, which prints it with
 * colons, so accepting only the bare form would reject a correct answer.
 */
export const normalizeMacAddress = (mac: string): string =>
  mac.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();

const requestJson = async (
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { what: string },
): Promise<{ status: number; body: unknown }> => {
  const { what, ...requestInit } = init;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...requestInit,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Failed to reach Delta Dore while ${what}: ${String(err)}`, { cause: err });
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // A proxy or captive portal answering with HTML — surface a truncated
    // excerpt rather than a bare "Unexpected token <".
    throw new Error(
      `Delta Dore returned a non-JSON response while ${what} (status=${response.status}): ${text.slice(0, 120)}`,
    );
  }
  return { status: response.status, body };
};

/** Exchange account credentials for a bearer token. */
export const requestAccessToken = async ({
  email,
  password,
  fetch: fetchImpl = globalThis.fetch,
}: {
  email: string;
  password: string;
  fetch?: FetchLike;
}): Promise<string> => {
  const discovery = await requestJson(fetchImpl, AUTH_CONFIG_URL, {
    what: "discovering the account API",
  });
  const openIdConfig = openIdConfigSchema.safeParse(discovery.body);
  if (!openIdConfig.success) {
    throw new Error("Delta Dore's OpenID configuration is missing a token endpoint.");
  }

  // multipart/form-data, which is what the ROPC policy expects; `FormData` sets
  // the boundary itself, so the Content-Type header must not be set by hand.
  const form = new FormData();
  form.set("username", email);
  form.set("password", password);
  form.set("grant_type", "password");
  form.set("client_id", CLIENT_ID);
  form.set("scope", SCOPE);
  form.set("response_type", "token");

  const { status, body } = await requestJson(fetchImpl, openIdConfig.data.token_endpoint, {
    method: "POST",
    body: form,
    what: "signing in to your Delta Dore account",
  });

  const token = tokenResponseSchema.safeParse(body);
  if (!token.success) {
    const error = tokenErrorSchema.safeParse(body);
    // B2C packs a multi-line diagnostic into error_description; the first line
    // is the human-readable part and the rest is a correlation id and timestamp.
    const detail = error.success
      ? (error.data.error_description?.split("\n")[0] ?? error.data.error)
      : undefined;
    throw new DeltaDoreAuthError(
      `Delta Dore rejected the account credentials (status=${status})${detail ? `: ${detail}` : "."}`,
    );
  }
  return token.data.access_token;
};

/**
 * Look up the gateway password for `mac` on the signed-in account.
 *
 * Returns the password, or throws if the account does not own that gateway.
 */
export const fetchGatewayPassword = async ({
  accessToken,
  mac,
  fetch: fetchImpl = globalThis.fetch,
}: {
  accessToken: string;
  mac: string;
  fetch?: FetchLike;
}): Promise<string> => {
  const normalizedMac = normalizeMacAddress(mac);
  const url = `${SITES_URL}?gateway_mac=${encodeURIComponent(normalizedMac)}`;
  const { status, body } = await requestJson(fetchImpl, url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    what: "looking up your gateway",
  });

  if (status === 401 || status === 403) {
    throw new DeltaDoreAuthError(
      `Your Delta Dore account is not allowed to read the credentials of gateway ${normalizedMac}.`,
    );
  }

  const parsed = sitesResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Delta Dore returned an unexpected site list (status=${status}) for gateway ${normalizedMac}.`,
    );
  }

  // The MAC is a query filter, not a guarantee — re-check it rather than trust
  // whichever site happens to come back first.
  const site = parsed.data.sites.find(
    (candidate) => normalizeMacAddress(candidate.gateway?.mac ?? "") === normalizedMac,
  );

  if (!site) {
    throw new DeltaDoreAuthError(
      `No gateway with MAC ${normalizedMac} is attached to this Delta Dore account. ` +
        `Check "username" against the MAC printed underneath your Tydom box.`,
    );
  }

  // A house the account can see but holds no credentials for. Observed on a
  // site shared with the account rather than owned by it, which comes back
  // without so much as a creation date. Saying "no such gateway" here would
  // send the user hunting for a typo in a MAC that is demonstrably correct —
  // the gateway password has to come from the account that registered it.
  if (!site.gateway?.password) {
    throw new DeltaDoreAuthError(
      `Delta Dore returned no password for gateway ${normalizedMac}. The account can see that ` +
        `house but does not hold its credentials — sign in with the account that registered the ` +
        `gateway, or set "password" to the gateway password directly and leave "email" out.`,
    );
  }
  return site.gateway.password;
};

/** Sign in, then read the gateway password. The whole flow, in one call. */
export const resolveGatewayPassword = async ({
  email,
  password,
  mac,
  fetch: fetchImpl = globalThis.fetch,
}: ResolveGatewayPasswordOptions): Promise<string> => {
  const accessToken = await requestAccessToken({ email, password, fetch: fetchImpl });
  return fetchGatewayPassword({ accessToken, mac, fetch: fetchImpl });
};
