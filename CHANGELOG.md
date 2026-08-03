# Changelog

All notable changes to this project will be documented in this file.

## [0.30.0](https://github.com/mgcrea/homebridge-tydom/compare/v0.29.0...v0.30.0)

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
- **alarm:** two alarms no longer report against each other's detectors.
- **alarm:** an in-use zone the panel did not describe now logs a warning instead of aborting setup with an assertion.
- **outlet:** state pushed by the gateway now reaches HomeKit. The update handler compared a numeric `level` against the string `"ON"`, which was never true.
- **smoke detector:** the low-battery characteristic now reports HomeKit's `LOW`/`NORMAL` values rather than a raw boolean.
- **garage door:** an ignored update no longer leaves the simulated travel timer running.
- **thermostat:** switching heating level now turns the other levels off.
- **echo suppression:** a write no longer clears the whole pending backlog on its first match, which lost suppression for interleaved writes.
- **dimmer, shutter:** dragging a slider sends one write rather than two, and buffered writes can no longer land out of order on a device that is physically moving. A tap still acts immediately.

### Features

- **reads:** device readings are held in memory and served straight to HomeKit instead of re-reading the gateway on every query. A reading older than `staleAfter` (default 5 minutes) is still returned immediately, with a background re-read pushing the corrected value out when it lands — so nothing waits on the gateway except the first read of each device, and staleness stays bounded despite there being no polling loop. Set `staleAfter` to `0` for the previous read-through behaviour.
- **config UI:** the schema now offers every supported option. `webhooks`, `refreshInterval`, `pin`, `locale` and the four include/exclude filters were previously reachable only by hand-editing `config.json`. Passwords and PINs are masked.
- **shutdown:** the plugin now releases its timers, closes the gateway connection and disposes every accessory when Homebridge shuts down.
- **discovery:** the three gateway endpoints discovery depends on are validated on arrival, so a protocol change is reported clearly instead of surfacing later as an unrelated failure. Device data stays unvalidated by design — unknown hardware is exactly what this plugin exists to onboard.

### Internals

- The plugin is layered: `src/api/` and `src/util/` do not import `homebridge` at all, which is what makes them testable. 164 tests, no HAP mocking and no sockets.
- All fourteen device types are classes over a common base, replacing pairs of `setup`/`update` functions dispatched through two parallel switch statements.
- Accessories no longer emit back into the controller, so per-accessory teardown is possible.
- Toolchain moved to oxlint, oxfmt, tsdown and vitest, with `@tsconfig/strictest` fully enabled.
- The Delta Dore label tables moved from TypeScript to JSON — a third of the repository is no longer type-checked to establish that a string is a string.

### [0.18.6](https://github.com/mgcrea/homebridge-tydom/compare/v0.18.5...v0.18.6) (2020-05-21)

### [0.18.5](https://github.com/mgcrea/homebridge-tydom/compare/v0.18.4...v0.18.5) (2020-05-19)

### [0.18.4](https://github.com/mgcrea/homebridge-tydom/compare/v0.18.3...v0.18.4) (2020-05-19)
