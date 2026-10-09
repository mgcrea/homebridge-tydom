# Local and fallback test protocol

This protocol exercises a working-tree build in an isolated Homebridge directory. It covers direct LAN access, startup fallback, runtime fallback, primary restoration and shutdown. Do not reuse the bridge identity or cache of a production Homebridge instance.

## Prerequisites

- Node.js 22, 24 or 26.
- pnpm 11, matching the version declared by this repository.
- The LAN address of the Tydom gateway.
- Its MAC-form username (`001A25XXXXXX`) and gateway password, or a Delta Dore account e-mail and password.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
mkdir -p .homebridge
```

Create `.homebridge/config.json` with a bridge identity used only for this test:

```json
{
  "bridge": {
    "name": "Homebridge Tydom Test",
    "username": "0E:21:1B:E7:27:C9",
    "port": 53619,
    "pin": "031-45-154"
  },
  "accessories": [],
  "platforms": [
    {
      "platform": "Tydom",
      "hostname": "mediation.tydom.com",
      "localHostname": "192.168.0.42",
      "primaryRetryInterval": 30,
      "username": "001A25XXXXXX",
      "password": "YourPassw0rd",
      "debug": true
    }
  ]
}
```

Do not commit this file. A base64-encoded `HOMEBRIDGE_TYDOM_PASSWORD` may be used instead of storing the password in it.

## Direct LAN connection

Set `hostname` to the LAN address and remove `localHostname`, then run:

```sh
pnpm run clean
DEBUG=homebridge-tydom,tydom-client pnpm dev:homebridge:insecure
```

Expected results:

- the client connects to the LAN address;
- `/ping` and the three discovery requests succeed;
- the accessories are scanned and registered;
- stopping Homebridge releases the socket and timers.

A certificate error usually means Homebridge was not started with the `:insecure` script. A timeout or `ECONNREFUSED` points to an incorrect or unreachable LAN address.

## Startup fallback

Use an intentionally invalid primary hostname while keeping the correct LAN address:

```json
{
  "hostname": "mediation.tydom.invalid",
  "localHostname": "192.168.0.42",
  "primaryRetryInterval": 30
}
```

Start the isolated bridge again. The log should show one failed primary connection followed by a successful local connection and a completed scan. It must not show an independent reconnect from the retired primary client.

## Runtime fallback

Restore `hostname` to `mediation.tydom.com`, start Homebridge, and wait for the primary connection. Then temporarily block Internet access while leaving the LAN available.

Expected sequence:

1. The active primary reports a disconnect.
2. One controller-owned retry is scheduled.
3. The local endpoint connects and state is re-synchronised once.
4. HomeKit reads and writes continue over the LAN.

Do not validate this by repeatedly toggling a device while the socket is failing: a command whose response is lost is intentionally not replayed, because applying it twice can be unsafe.

## Primary restoration

With local fallback active, restore Internet access. At the next `primaryRetryInterval` the log should show a primary check. The local socket stays active until the primary `/ping` succeeds. The controller then switches atomically, closes the retired local client and performs one queued re-sync.

Useful log fragments are:

```text
Checking if primary Tydom hostname=mediation.tydom.com is available again...
Successfully connected to primary Tydom hostname=mediation.tydom.com
Restored primary Tydom hostname=mediation.tydom.com, switching back from local fallback
```

## Shutdown during recovery

Block the primary, wait until local fallback is active or a reconnect is pending, then stop Homebridge with `Ctrl+C`. No new connection or refresh line should appear afterwards, and the process should exit without being killed.

## Legacy TLS renegotiation

Some older gateways fail locally with `ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED`. For a trusted, isolated test only, create `.homebridge/openssl-legacy.cnf`:

```ini
openssl_conf = openssl_init

[openssl_init]
ssl_conf = ssl_sect

[ssl_sect]
system_default = system_default_sect

[system_default_sect]
Options = UnsafeLegacyRenegotiation
```

Then launch with:

```sh
NODE_OPTIONS="--openssl-shared-config --openssl-config=$PWD/.homebridge/openssl-legacy.cnf" \
  DEBUG=homebridge-tydom,tydom-client \
  pnpm dev:homebridge:insecure
```

Keep this override limited to the Homebridge process which needs the legacy gateway.
