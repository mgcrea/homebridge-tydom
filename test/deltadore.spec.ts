import { describe, expect, it, vi } from "vitest";
import {
  DeltaDoreAuthError,
  fetchGatewayPassword,
  normalizeMacAddress,
  requestAccessToken,
  resolveGatewayPassword,
  type FetchLike,
} from "../src/util/deltadore.js";

const TOKEN_ENDPOINT = "https://example.test/token";
const MAC = "001A25123456";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/**
 * A fetch double that answers by URL substring.
 *
 * The flow is three hops against two hosts, so dispatching on the URL keeps the
 * tests readable and lets one hop fail while the others succeed.
 */
const fakeFetch = (routes: { match: string; respond: () => Response }[]) =>
  vi.fn<FetchLike>((input) => {
    const url = String(input);
    const route = routes.find(({ match }) => url.includes(match));
    if (!route) {
      throw new Error(`Unexpected request to ${url}`);
    }
    return Promise.resolve(route.respond());
  });

/** The URL and init of the nth call, as the assertions want them. */
const callAt = (
  fetch: ReturnType<typeof fakeFetch>,
  index: number,
): { url: string; init: RequestInit } => {
  const call = fetch.mock.calls[index];
  if (!call) {
    throw new Error(`Expected a request at index ${index}`);
  }
  return { url: String(call[0]), init: call[1] ?? {} };
};

const discoveryRoute = {
  match: ".well-known/openid-configuration",
  respond: () => json({ token_endpoint: TOKEN_ENDPOINT }),
};
const tokenRoute = (body: unknown, status = 200) => ({
  match: "/token",
  respond: () => json(body, status),
});
const sitesRoute = (body: unknown, status = 200) => ({
  match: "/sitesmanagement/",
  respond: () => json(body, status),
});

describe("normalizeMacAddress", () => {
  it.each([
    ["00:1A:25:12:34:56", "001A25123456"],
    ["00-1a-25-12-34-56", "001A25123456"],
    ["001a25123456", "001A25123456"],
  ])("normalises %s to the form the API matches on", (input, expected) => {
    expect(normalizeMacAddress(input)).toBe(expected);
  });
});

describe("requestAccessToken", () => {
  it("discovers the token endpoint, then posts the credentials to it", async () => {
    const fetch = fakeFetch([discoveryRoute, tokenRoute({ access_token: "tok" })]);
    await expect(requestAccessToken({ email: "a@b.test", password: "pw", fetch })).resolves.toBe(
      "tok",
    );

    // The token request has to be a POST, and must go to the *discovered*
    // endpoint rather than a hard-coded one.
    const { url, init } = callAt(fetch, 1);
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("username")).toBe("a@b.test");
    expect(form.get("password")).toBe("pw");
    expect(form.get("grant_type")).toBe("password");
    // FormData must set its own multipart boundary.
    expect(init.headers).toBeUndefined();
  });

  it("reports a rejected sign-in as an auth error, quoting Delta Dore's reason", async () => {
    const fetch = fakeFetch([
      discoveryRoute,
      tokenRoute(
        {
          error: "invalid_grant",
          error_description: "AADB2C90225: The username or password provided\nCorrelation ID: x",
        },
        400,
      ),
    ]);
    const promise = requestAccessToken({ email: "a@b.test", password: "wrong", fetch });
    await expect(promise).rejects.toBeInstanceOf(DeltaDoreAuthError);
    // Only the first line: the rest is a correlation id and a timestamp.
    await expect(promise).rejects.toThrow("AADB2C90225: The username or password provided");
    await expect(promise).rejects.not.toThrow("Correlation ID");
  });

  it("fails clearly when discovery does not name a token endpoint", async () => {
    const fetch = fakeFetch([{ match: ".well-known", respond: () => json({}) }]);
    await expect(requestAccessToken({ email: "a@b.test", password: "pw", fetch })).rejects.toThrow(
      "missing a token endpoint",
    );
  });

  it("surfaces an HTML error page as such, rather than a JSON parse error", async () => {
    const fetch = fakeFetch([
      {
        match: ".well-known",
        respond: () => new Response("<!doctype html><h1>Gateway Timeout</h1>", { status: 504 }),
      },
    ]);
    await expect(requestAccessToken({ email: "a@b.test", password: "pw", fetch })).rejects.toThrow(
      /non-JSON response .*status=504/,
    );
  });
});

describe("fetchGatewayPassword", () => {
  it("returns the password of the site whose MAC matches", async () => {
    const fetch = fakeFetch([
      sitesRoute({
        count: 1,
        sites: [{ id: "site-1", gateway: { mac: MAC, password: "gw-secret" } }],
      }),
    ]);
    await expect(fetchGatewayPassword({ accessToken: "tok", mac: MAC, fetch })).resolves.toBe(
      "gw-secret",
    );
  });

  it("normalises the MAC before querying, so a label-formatted one works", async () => {
    const fetch = fakeFetch([
      sitesRoute({ sites: [{ gateway: { mac: MAC, password: "gw-secret" } }] }),
    ]);
    await fetchGatewayPassword({ accessToken: "tok", mac: "00:1a:25:12:34:56", fetch });
    expect(callAt(fetch, 0).url).toContain(`gateway_mac=${MAC}`);
  });

  it("ignores a site the query returned whose MAC is not the one asked for", async () => {
    // The MAC is a filter, not a guarantee — trusting sites[0] would hand back
    // another gateway's password.
    const fetch = fakeFetch([
      sitesRoute({ sites: [{ gateway: { mac: "001A25999999", password: "other" } }] }),
    ]);
    await expect(fetchGatewayPassword({ accessToken: "tok", mac: MAC, fetch })).rejects.toThrow(
      `No gateway with MAC ${MAC}`,
    );
  });

  it("treats an empty site list as a configuration error naming the MAC", async () => {
    const fetch = fakeFetch([sitesRoute({ count: 0, sites: [] })]);
    const promise = fetchGatewayPassword({ accessToken: "tok", mac: MAC, fetch });
    await expect(promise).rejects.toBeInstanceOf(DeltaDoreAuthError);
    await expect(promise).rejects.toThrow(MAC);
  });

  it("distinguishes a real gateway the account has no access to", async () => {
    // Observed against the live API, on a house the account confirmed it has no
    // access to: the site still comes back — the MAC lookup is not gated — but
    // its gateway carries no `password`. Reporting that as "no such gateway"
    // sends the user hunting a typo that is not there.
    const fetch = fakeFetch([
      sitesRoute({ count: 1, sites: [{ id: "site-2", gateway: { mac: MAC } }] }),
    ]);
    const promise = fetchGatewayPassword({ accessToken: "tok", mac: MAC, fetch });
    await expect(promise).rejects.toBeInstanceOf(DeltaDoreAuthError);
    await expect(promise).rejects.toThrow("no password for gateway");
    await expect(promise).rejects.not.toThrow("No gateway with MAC");
  });

  it.each([401, 403])("reports HTTP %i as an authorisation problem", async (status) => {
    const fetch = fakeFetch([sitesRoute({ code: "FORBIDDEN" }, status)]);
    await expect(
      fetchGatewayPassword({ accessToken: "tok", mac: MAC, fetch }),
    ).rejects.toBeInstanceOf(DeltaDoreAuthError);
  });

  it("sends the bearer token", async () => {
    const fetch = fakeFetch([sitesRoute({ sites: [{ gateway: { mac: MAC, password: "p" } }] })]);
    await fetchGatewayPassword({ accessToken: "tok", mac: MAC, fetch });
    const { init } = callAt(fetch, 0);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });
});

describe("resolveGatewayPassword", () => {
  it("runs the whole flow, from account credentials to gateway password", async () => {
    const fetch = fakeFetch([
      discoveryRoute,
      tokenRoute({ access_token: "tok" }),
      sitesRoute({ sites: [{ gateway: { mac: MAC, password: "gw-secret" } }] }),
    ]);
    await expect(
      resolveGatewayPassword({ email: "a@b.test", password: "pw", mac: MAC, fetch }),
    ).resolves.toBe("gw-secret");
  });

  it("does not reach the site API when the sign-in fails", async () => {
    const fetch = fakeFetch([discoveryRoute, tokenRoute({ error: "invalid_grant" }, 400)]);
    await expect(
      resolveGatewayPassword({ email: "a@b.test", password: "pw", mac: MAC, fetch }),
    ).rejects.toBeInstanceOf(DeltaDoreAuthError);
    expect(fetch.mock.calls).toHaveLength(2);
  });
});
