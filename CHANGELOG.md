# Changelog

All notable changes to this project will be documented in this file.

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
