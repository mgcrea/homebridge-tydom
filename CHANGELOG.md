# Changelog

All notable changes to this project will be documented in this file.

## [0.32.0](https://github.com/mgcrea/homebridge-tydom/compare/v0.31.2...v0.32.0) (2026-08-30)

No accessory is re-registered by this release: rooms, names and automations are preserved. Nothing changes for a thermostat that already worked — both changes below activate only on hardware that reports itself differently.

### Features

- **thermostat:** reversible units can cool. A heat pump that runs in reverse advertises `COOLING` among the values its `authorization` property accepts, and HomeKit is offered a cool mode only on hardware that does. A radiator is untouched: it keeps the same two modes and the same single-property write it has always had, since whether the gateway accepts a write to `authorization` on a device with no use for one is not something that can be established without the hardware. Built from the work in [#182](https://github.com/mgcrea/homebridge-tydom/pull/182) by @jrozelle.

### Bug Fixes

- **thermostat:** Tybox 5100 thermostats work again. Delta Dore dropped `hvacMode` on this hardware and moved the operating mode to `localMode`, carrying the same values plus an `ABSENCE` that reads as off. Reading a property that is not there throws, so the accessory was discovered and registered and then failed on every HomeKit query with `Missing property with name="hvacMode" in endpoint data`. The mode property is now resolved from the device's own metadata, `hvacMode` when it exists and `localMode` otherwise. Reported in [#185](https://github.com/mgcrea/homebridge-tydom/issues/185) with the metadata dump that made it fixable without the hardware.

### Internals

- The thermostat has tests, 40 of them, against the in-memory HAP double added in 0.31.2. Twenty were written before either change above and pin the previous heat-only behaviour; they still pass untouched, which is what establishes that existing installs are unaffected. `src/accessories` coverage goes from 18.8% to 33.4%.

## [0.31.2](https://github.com/mgcrea/homebridge-tydom/compare/v0.31.1...v0.31.2) (2026-08-30)

No accessory is re-registered by this release: rooms, names and automations are preserved. Seven device types were rewritten internally, but they publish the same services and characteristics as before.

### Bug Fixes

- **config:** a password containing an accent works. The base64 environment escape hatches decoded as ASCII, which masks the high bit of every byte, silently turning a password such as `Été2024` into mojibake. It went unnoticed while the only secrets passed that way were a gateway password and a PIN; a Delta Dore account password is one you chose yourself, and a sign-in with a mangled one fails with nothing but an opaque `invalid_grant` to go on.
- **config:** a rejected Delta Dore account password is reported at once. It was indistinguishable from the gateway being unreachable, so the startup retry ladder re-submitted the same wrong password eleven times over about twenty-five minutes — which earns a lockout from Azure AD B2C and never a connection. Credentials are now resolved before the socket is attempted, and a rejection stops the ladder rather than feeding it.
- **shutdown:** Homebridge shutting down no longer leaves the plugin running. `tydom-client` reconnects whenever its socket closes, and closing it is exactly what shutdown does — so every shutdown started a reconnection, which re-armed the refresh interval the platform had just cleared and replayed device state into accessories that were already disposed. The re-armed interval was also the one place the timer was not `unref`-ed, so a bridge that had reconnected even once could no longer exit on its own and had to be killed.
- **reconnection:** a flapping connection starts one re-sync, not one per attempt. Each `connect` used to begin its own, so several `/ping` and `/refresh/all` round trips ran concurrently and each re-installed the refresh interval the last had just set up.
- **startup:** a connection that comes up while the retry ladder is waiting is used, instead of a second one being opened alongside it. Both the plugin and `tydom-client` retry, and after a failed first attempt the two ran independently.
- **webhooks:** an alarm notification naming a device with an accent in it is delivered. `Content-Length` was computed from string length rather than byte length, so anything non-ASCII under-reported its own size and the request truncated or hung. A webhook URL carrying a query string — a Discord `?thread_id=` — had it dropped, and a webhook that answered with an error page took the whole bridge down: the response was parsed outside the promise's frame, where a failure surfaces as an uncaught exception rather than a rejection.
- **alarm:** a failed zone-label query now says what went wrong. The error was discarded entirely and the warning mentioned only that it had happened.
- **accessories:** rebuilding an accessory no longer leaves its predecessor behind. The `identify` listener was never detached, so each rebuild against the same accessory — which is what a category change does — added another copy, each holding a dead handler alive.

### Behaviour changes

- **config:** `webhooks` and `settings` are checked at startup, and a bad entry is dropped with a line saying why rather than silently doing nothing. Previously only the outermost shape was checked, so a mistyped webhook URL was accepted and then threw when the alarm eventually fired, and a device-settings key that was not a numeric device id matched nothing at all with no indication. Entries are validated one at a time, so one bad webhook does not discard the others.

  A malformed entry here does **not** stop the plugin. The connection fields still do — without a hostname there is nothing to talk to — but a typo in a notification URL costs you that notification, not your lights.

### Internals

- The seven device types that were nothing but a characteristic-to-property mapping are declared as data rather than written out. Each characteristic's mapping is now stated once and used for both reads and pushes, so the two directions cannot disagree. Nothing was wrong with them going in — but two of the bugs fixed in `0.30.0`, the outlet comparing a numeric `level` against `"ON"` and the smoke detector's raw low-battery boolean, were both a push path having drifted from the read path beside it, and that is the shape this removes.
- The accessory layer has tests for the first time, against a small in-memory HAP double. It refuses to answer for a characteristic constant it has not been given a real value for, because a double that returns `undefined` lets a wrong mapping pass green. The controller has tests for the first time too, covering the reconnection paths above. 285 tests, still no HAP dependency and no sockets.
- Requests to the gateway are spaced by a few milliseconds. Nothing bounded the burst a Home app refresh or a scene produced, and the gateway is a small embedded box. Starts are spaced rather than completions serialised, so one slow relayed response cannot stall unrelated reads behind it.
- `lodash` is gone. The dependency existed for a single function call.
- `source-map-support` is gone too, in favour of Node's built-in `process.setSourceMapsEnabled`. It only maps frames for modules compiled after it runs, so the platform is now pulled in through a dynamic import to put it in a later-compiled chunk; stack traces still resolve to the TypeScript sources, with one fewer runtime dependency.
- The published package carries a `LICENSE` file. The MIT terms were only ever stated in the README and the `package.json` field, so the tarball on npm shipped without the license text it grants under.

## [0.31.1](https://github.com/mgcrea/homebridge-tydom/compare/v0.31.0...v0.31.1) (2026-08-06)

### Bug Fixes

- **config:** signing in with an account that can see a house but holds no credentials for it now says so. Delta Dore returns such a site — one shared with the account rather than registered by it — with its gateway password missing, which was indistinguishable from the MAC not matching at all: the error told you no gateway with that MAC was attached to the account, sending you hunting for a typo in a MAC that was demonstrably correct. It now names the real problem and both ways out — sign in with the account that registered the gateway, or set `password` to the gateway password directly and leave `email` out.

## [0.31.0](https://github.com/mgcrea/homebridge-tydom/compare/v0.30.1...v0.31.0) (2026-08-06)

No accessory is re-registered by this release: rooms, names and automations are preserved. Existing configurations keep working unchanged — the new option below is opt-in.

### Features

- **config:** the gateway password can be looked up from your Delta Dore account. Newer setups have the app generate that password and never show it to you, so the only way to get at it was to inspect the app's traffic with an SSL proxy. Set the new `email` field to the address you sign in to the Tydom app with, and `password` is read as your **account** password instead: the plugin signs in at startup, looks up the gateway named in `username`, and uses the gateway password it gets back. Leave `email` out — the default, and what every existing install has — and `password` keeps its old meaning of the gateway's own password. Also accepted as `HOMEBRIDGE_TYDOM_EMAIL`.

  The account has to already own that gateway: there is no public API that lists the gateways on an account, so `username` stays required either way. This looks a password up, it cannot discover which houses you have.

- **cli:** `pnpm resolve-credentials <email> <password> <username>` checks an account and gateway pair without waiting on Homebridge to start.

### Bug Fixes

- **config:** the Homebridge UI now describes both meanings of `password`, so the field does not silently change what it wants depending on whether `email` is filled in.

## [0.30.1](https://github.com/mgcrea/homebridge-tydom/compare/v0.30.0...v0.30.1) (2026-08-04)

### Bug Fixes

- **accessories:** the accessory cache is written again. Every newly discovered accessory was handed to Homebridge for caching *before* it was registered, and registration is the only thing that stamps an accessory's plugin association — so the write threw `Cannot serialize accessory 'X' - missing associated plugin` and, because one failure aborts the whole file, nothing at all persisted. The failed write had already inserted the accessory into Homebridge's cached list, which registration then appended to a second time, so each accessory was eventually written twice and came back on the next boot as `Accessory 'X' has the same UUID as existing accessory 'X'. Skipping duplicate.`

  Most installations recover on their own once restarted: Homebridge rewrites one entry per accessory on the first successful scan. An accessory that was duplicated and then removed from the gateway can be left orphaned in the cache — see [Troubleshooting](https://github.com/mgcrea/homebridge-tydom#duplicate-accessories-or-cannot-serialize-accessory) for the one-time reset.

- **startup:** `Properly loaded N-accessories` reports the real count. Devices are announced synchronously while their handlers are still starting up, and the count was logged before any of them had finished, so a fully populated gateway reported `0-accessories`.
- **startup:** accessories removed during the startup sweep are no longer counted as loaded, and their handlers and companion links are released rather than left behind. Unregistering an accessory told Homebridge but left the platform's own tables untouched.

## [0.30.0](https://github.com/mgcrea/homebridge-tydom/compare/v0.29.0...v0.30.0) (2026-08-03)

No accessory is re-registered by this release: rooms, names and automations are preserved. See [Migrating to v0.30](https://github.com/mgcrea/homebridge-tydom#migrating-to-v030).

### ⚠ BREAKING CHANGES

- **Homebridge v2.0 or later is required.** Support for the 1.x line is dropped.
- **Node.js v22, v24 or v26 is required.** Support for v18 and v20 is dropped.
- The plugin is now pure ESM. Invisible unless you were importing it programmatically.

### Bug Fixes

- **discovery:** one unrecognised endpoint no longer drops every remaining endpoint of the same device. A `return` inside a `forEach` callback exited the whole device rather than skipping the endpoint, so devices could silently lose accessories depending on the order the gateway listed them.
- **config:** device settings are no longer written back into your live config. Detected values such as `legacy` and `smokeDetector` were assigned into the config object in place and persisted across re-scans.
- **config:** `locale` set in `config.json` now takes effect. It was read at module load, before Homebridge had opened the config file, so only `HOMEBRIDGE_TYDOM_LOCALE` ever worked.
- **config:** a bad configuration no longer takes the bridge down. The platform reports the problem once and stays dormant.
- **multi-gateway:** two Tydom platforms in one Homebridge process no longer interfere. The request cache, the garage door's timer table, and the alarm's detector list were all module-level, so a second gateway overwrote the first's state.
- **alarm:** the zone switches turn off when the system is disarmed from the main selector. They only ever moved because the panel volunteered that zone's state, and it does not always do so on a whole-system mode change — it can report `alarmMode: "OFF"` and nothing else, and the `arret` event carries no zone state at all. A switch that did move then flipped back, because reads still resolved the stale per-zone property. The panel's mode now settles every switch and outranks the property: a disarmed system has no armed zones, a fully armed one has nothing but.
- **alarm:** the opening-detectors companion accessory is registered again. It shares its panel's gateway endpoint by design, and the announce loop deduplicated on the endpoint rather than on the accessory, so the panel always claimed the key first and the companion was silently dropped. Affects anyone who has not set `sensors: false`.
- **alarm:** two alarms no longer report against each other's detectors.
- **alarm:** an in-use zone the panel did not describe now logs a warning instead of aborting setup with an assertion.
- **outlet:** state pushed by the gateway now reaches HomeKit. The update handler compared a numeric `level` against the string `"ON"`, which was never true.
- **smoke detector:** the low-battery characteristic now reports HomeKit's `LOW`/`NORMAL` values rather than a raw boolean.
- **garage door:** an ignored update no longer leaves the simulated travel timer running.
- **thermostat:** switching heating level now turns the other levels off.
- **thermostat:** a device driven by thermic levels rather than a temperature — a towel rail, typically — reports no setpoint at all. Reading its target temperature handed HomeKit a null, which HAP rejects and warns about on every query.
- **echo suppression:** a write no longer clears the whole pending backlog on its first match, which lost suppression for interleaved writes.
- **dimmer:** switching a light on at a brightness sends one write instead of two. HomeKit maps both `On` and `Brightness` onto the same `level`, so the gesture arrived as two writes of the same value a millisecond apart and the trailing one repeated the leading one verbatim. A tap still acts immediately.
- **dimmer, shutter:** buffered writes can no longer land out of order on a device that is physically moving. The gateway applies writes in arrival order with no revision check, and `lodash.debounce` had no way to chain them.
- **debug log:** trace lines identify the device they are about. They logged a Service's `UUID`, which is its *type* — every light in the house reported `00000043-…`, so a log with seven lights in it could not be read.

### Features

- **reads:** device readings are held in memory and served straight to HomeKit instead of re-reading the gateway on every query. A reading older than `staleAfter` (default 5 minutes) is still returned immediately, with a background re-read pushing the corrected value out when it lands — so nothing waits on the gateway except the first read of each device, and staleness stays bounded despite there being no polling loop. Set `staleAfter` to `0` for the previous read-through behaviour.
- **config UI:** the schema now offers every supported option. `webhooks`, `refreshInterval`, `pin`, `locale` and the four include/exclude filters were previously reachable only by hand-editing `config.json`. Passwords and PINs are masked.
- **shutdown:** the plugin now releases its timers, closes the gateway connection and disposes every accessory when Homebridge shuts down.
- **discovery:** the three gateway endpoints discovery depends on are validated on arrival, so a protocol change is reported clearly instead of surfacing later as an unrelated failure. Device data stays unvalidated by design — unknown hardware is exactly what this plugin exists to onboard.

### Notes

- **Unlabeled zone switches are a Home app display setting, not a plugin bug.** Turn on **Show as separate tiles** in the accessory's settings and the captions appear; merged into a single tile the Home app captions none of an accessory's sub-services. `0.30.0-beta.2` and `beta.3` both tried to fix this from the plugin side — first by adding `ConfiguredName`, then by unlinking the zone switches from the panel service — and neither was the cause. The unlink is reverted. A zone still cannot have a room or be an automation target, because those belong to an accessory rather than a service; that would need one accessory per zone.

### Internals

- The plugin is layered: `src/api/` and `src/util/` do not import `homebridge` at all, which is what makes them testable. 191 tests, no HAP mocking and no sockets.
- All fourteen device types are classes over a common base, replacing pairs of `setup`/`update` functions dispatched through two parallel switch statements.
- Accessories no longer emit back into the controller, so per-accessory teardown is possible.
- Toolchain moved to oxlint, oxfmt, tsdown and vitest, with `@tsconfig/strictest` fully enabled.
- The Delta Dore label tables moved from TypeScript to JSON — a third of the repository is no longer type-checked to establish that a string is a string.

### [0.18.6](https://github.com/mgcrea/homebridge-tydom/compare/v0.18.5...v0.18.6) (2020-05-21)

### [0.18.5](https://github.com/mgcrea/homebridge-tydom/compare/v0.18.4...v0.18.5) (2020-05-19)

### [0.18.4](https://github.com/mgcrea/homebridge-tydom/compare/v0.18.3...v0.18.4) (2020-05-19)
