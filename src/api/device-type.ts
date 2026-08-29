import { sha256Sync } from "../util/hash.js";
import type { TydomMetaElement } from "./types.js";

/**
 * What a Tydom endpoint is, as far as this plugin is concerned.
 *
 * This is deliberately a string union rather than a HAP `Categories` value: it
 * is the dispatch key for the accessory registry, and keeping it framework-free
 * is what lets device resolution be tested without HAP.
 *
 * It is *not* interchangeable with the HAP category — `contact-sensor` covers
 * both DOOR and WINDOW accessories, which share a handler but must keep their
 * distinct category numbers. Resolution therefore reports both.
 */
export type DeviceType =
  | "alarm"
  | "alarm-sensors"
  | "contact-sensor"
  | "fan"
  | "garage-door"
  | "lightbulb"
  | "lightbulb-switchable"
  | "outlet"
  | "smoke-detector"
  | "sunlight-sensor"
  | "switch"
  | "temperature-sensor"
  | "thermostat"
  | "trigger-switch"
  | "window-covering";

/**
 * HAP accessory category numbers.
 *
 * Hardcoded rather than imported from HAP for two reasons. Firstly, hap-nodejs
 * declares `Categories` as an ambient `const enum`, which `isolatedModules` and
 * `verbatimModuleSyntax` both forbid referencing. Secondly, and more
 * importantly, these numbers are persisted in every user's `cachedAccessories`
 * file: they are a storage format, not an implementation detail. Changing one
 * makes Homebridge re-register the accessory, and the user loses its room
 * assignment and any automation referencing it.
 *
 * Values verified against @homebridge/hap-nodejs 2.2.2, the version homebridge
 * 2.4.0 ships.
 */
export const CATEGORY = {
  FAN: 3,
  GARAGE_DOOR_OPENER: 4,
  LIGHTBULB: 5,
  OUTLET: 7,
  SWITCH: 8,
  THERMOSTAT: 9,
  SENSOR: 10,
  SECURITY_SYSTEM: 11,
  DOOR: 12,
  WINDOW: 13,
  WINDOW_COVERING: 14,
  /**
   * Synthetic, not a real HAP category. Previously computed as
   * `parseInt(`${SECURITY_SYSTEM}0`)`. Kept verbatim so cached alarm-sensor
   * accessories keep their identity.
   */
  ALARM_SENSORS: 110,
} as const;

export type CategoryValue = (typeof CATEGORY)[keyof typeof CATEGORY];

/** Settings a hardware signature can imply, independently of the user's config. */
export type ImpliedSettings = {
  legacy?: boolean;
  smokeDetector?: boolean;
  sunlightSensor?: boolean;
};

/** Settings that steer resolution but come from the user's config. */
export type ResolutionSettings = ImpliedSettings & {
  trigger?: boolean;
};

/**
 * The endpoint metadata property names, sorted and joined. This is the input to
 * the signature hash, so its exact output is load-bearing: a change here
 * silently unbinds every user's device from its category.
 */
export const getEndpointSignatureFromMetadata = (metadata: TydomMetaElement[]): string =>
  metadata
    .map((value) => value.name)
    .toSorted()
    .join("|");

type Match = {
  deviceType: DeviceType;
  category: CategoryValue;
  /** Settings the hardware implies, which the user cannot be expected to know. */
  impliedSettings?: ImpliedSettings;
};

/**
 * Endpoints whose type could not be told apart by `first_usage` alone, keyed by
 * `<first_usage>:<sha256 of the metadata signature>`.
 *
 * Each entry is annotated with the GitHub reporter and the hardware model it
 * came from. Add to it with `pnpm hash` against a user's device dump.
 */
const SIGNATURE_MATCHES: Record<string, Match> = {
  "alarm:0c6e1d33808fa50a0a921502f80d36430dfaeda5abfed2467f9f2b07821e4842": {
    deviceType: "alarm",
    category: CATEGORY.SECURITY_SYSTEM,
  }, // @maaxleop
  "alarm:6e33f7ee5e62b58f4e888c91a13fd9b9d868f3751cead5ea1252578ba86523a5": {
    deviceType: "alarm",
    category: CATEGORY.SECURITY_SYSTEM,
    // CTX60 has no bulk zone command; it addresses parts one at a time.
    impliedSettings: { legacy: true },
  }, // @StephanH27.1521931577 (CTX60) #50
  "alarm:aad768ee0367013a974276117fd5ed4834cc26e4d31acc88d35134731331b0e7": {
    deviceType: "alarm",
    category: CATEGORY.SECURITY_SYSTEM,
  }, // @mgcrea.1521931577 (TYXAL+)
  "awning:48f43ebab20eba438fa9cc2b6ce44311d3cfb01c5be84bf17599d9c152c348d3": {
    deviceType: "window-covering",
    category: CATEGORY.WINDOW_COVERING,
  }, // @baschte_ (TYXIA 5731)
  "belmDoor:fb935867933d89b3058f09384f76fd63f3defb18cfb3172f60fa9f4f237f748b": {
    deviceType: "contact-sensor",
    category: CATEGORY.DOOR,
  }, // @mgcrea (MDO)
  "conso:16804a9994bce28275150db329a9c0b931ef7f20608c1a3d2ff248f58569f0d3": {
    deviceType: "temperature-sensor",
    category: CATEGORY.SENSOR,
  }, // @maaxleop (STE 2000)
  "garage_door:83b0912c6fe14622219522922ea0347dcbf86bf9cfd3346a2eca8eac70ca8260": {
    deviceType: "garage-door",
    category: CATEGORY.GARAGE_DOOR_OPENER,
  }, // @Benzoiiit (TYXIA 4620)
  "gate:83b0912c6fe14622219522922ea0347dcbf86bf9cfd3346a2eca8eac70ca8260": {
    deviceType: "garage-door",
    category: CATEGORY.GARAGE_DOOR_OPENER,
  }, // @mgcrea (TYXIA 4620)
  "hvac:16804a9994bce28275150db329a9c0b931ef7f20608c1a3d2ff248f58569f0d3": {
    deviceType: "temperature-sensor",
    category: CATEGORY.SENSOR,
  }, // @D-Roch + @tanabay27 (Sonde TYBOX 2020 Wt)
  "hvac:17f933bec8ed29f9b2a2cd5280fb5b64806cf8a1c064c83950e350f491d7cb9f": {
    deviceType: "thermostat",
    category: CATEGORY.THERMOSTAT,
  }, // @Armen85 (RF6600FP) @FIXME
  "hvac:1bab47d1dd7e898b5dc2e9867b14dfb8bc9272c4cb0b5d1221da962d43a6ffb4": {
    deviceType: "thermostat",
    category: CATEGORY.THERMOSTAT,
  }, // @mgcrea (RF4890)
  "light:449e2a60377094cde10224cee91d378fb0ae373ae6ceea0ac2cbc1ed011bffa7": {
    deviceType: "lightbulb",
    category: CATEGORY.LIGHTBULB,
  }, // @mgcrea (TYXIA 5610, TYXIA 6610)
  "light:fce45085835f4f2790ea3b17d208b5ace34935444d2535e75ba3f0a2ce86de5f": {
    deviceType: "lightbulb",
    category: CATEGORY.LIGHTBULB,
  }, // @mgcrea (TYXIA 5650)
  "others:449e2a60377094cde10224cee91d378fb0ae373ae6ceea0ac2cbc1ed011bffa7": {
    deviceType: "lightbulb",
    category: CATEGORY.LIGHTBULB,
  }, // @diegomarino (TYXIA 4600)
  "plug:2534c497ff8fb013a88da28d341adff5bc0ba77e1fc8ea8dcb8b8f1c9d62ce19": {
    deviceType: "outlet",
    category: CATEGORY.OUTLET,
  }, // @Neo33ASM (Easy Plug)
  "sensor:556f8aaf51e3807397b7e326d0aad4b61cceb8279166b50204f8a2e95464c9ba": {
    deviceType: "temperature-sensor",
    category: CATEGORY.SENSOR,
    // DFR TYXAL+ reports as a generic sensor but is a smoke detector; the
    // implied setting narrows it below.
    impliedSettings: { smokeDetector: true },
  }, // DFR TYXAL+
  "shutter:c3fe8e2afa864e1a7a5c6676b4287a7b2f2a886a466baec3df8a1ec4f898ad6c": {
    deviceType: "window-covering",
    category: CATEGORY.WINDOW_COVERING,
  }, // @maaxleop
  "window:fb935867933d89b3058f09384f76fd63f3defb18cfb3172f60fa9f4f237f748b": {
    deviceType: "contact-sensor",
    category: CATEGORY.WINDOW,
  }, // @mgcrea (MDO)
};

/** Fallback when the signature is unknown: resolve on `first_usage` alone. */
const FIRST_USAGE_MATCHES: Record<string, Match> = {
  alarm: { deviceType: "alarm", category: CATEGORY.SECURITY_SYSTEM },
  awning: { deviceType: "window-covering", category: CATEGORY.WINDOW_COVERING },
  belmDoor: { deviceType: "contact-sensor", category: CATEGORY.DOOR },
  garage_door: { deviceType: "garage-door", category: CATEGORY.GARAGE_DOOR_OPENER },
  gate: { deviceType: "garage-door", category: CATEGORY.GARAGE_DOOR_OPENER },
  hvac: { deviceType: "thermostat", category: CATEGORY.THERMOSTAT },
  light: { deviceType: "lightbulb", category: CATEGORY.LIGHTBULB },
  plug: { deviceType: "outlet", category: CATEGORY.OUTLET },
  shutter: { deviceType: "window-covering", category: CATEGORY.WINDOW_COVERING },
  window: { deviceType: "contact-sensor", category: CATEGORY.WINDOW },
};

export type ResolveDeviceTypeInput = {
  firstUsage: string;
  metadata: TydomMetaElement[];
  settings: ResolutionSettings;
};

export type DeviceTypeResolution = {
  deviceType: DeviceType;
  category: CategoryValue;
  /** Settings implied by the hardware signature. Never applied in place. */
  impliedSettings: ImpliedSettings;
  /** `<first_usage>:<sha256>`, useful in logs when a device is unrecognised. */
  signatureHash: string;
};

/**
 * Work out what an endpoint is from its metadata signature.
 *
 * Pure: unlike the version this replaces, it does not write the implied
 * settings back into the caller's object — which used to mutate the user's live
 * platform config and persist across re-scans.
 */
export const resolveDeviceType = (
  input: ResolveDeviceTypeInput,
): DeviceTypeResolution | undefined => {
  const { firstUsage, metadata, settings } = input;
  const signatureHash = `${firstUsage}:${sha256Sync(getEndpointSignatureFromMetadata(metadata))}`;

  const match = SIGNATURE_MATCHES[signatureHash] ?? FIRST_USAGE_MATCHES[firstUsage];
  if (!match) {
    return undefined;
  }

  const impliedSettings = match.impliedSettings ?? {};
  // Implied settings win over the user's, matching the precedence the previous
  // Object.assign-based version had.
  const effective = { ...settings, ...impliedSettings };

  return {
    deviceType: narrowDeviceType(match.deviceType, effective, metadata),
    category: match.category,
    impliedSettings,
    signatureHash,
  };
};

/**
 * Map a HAP category number back to a device type.
 *
 * Needed because `settings.<deviceId>.category` lets a user pin an endpoint to
 * an arbitrary HAP category, and because a cached accessory restored from a
 * previous release carries a category but no device type. This is the inverse
 * of the two switch statements that used to live in helpers/accessory.ts —
 * including the `switch`/`fan` categories, which resolution itself never
 * produces and which are only reachable through that override.
 */
export const deviceTypeForCategory = (
  category: number,
  settings: ResolutionSettings = {},
  metadata: TydomMetaElement[] = [],
): DeviceType | undefined => {
  const base = ((): DeviceType | undefined => {
    switch (category) {
      case CATEGORY.LIGHTBULB:
        return "lightbulb";
      case CATEGORY.OUTLET:
        return "outlet";
      case CATEGORY.THERMOSTAT:
        return "thermostat";
      case CATEGORY.FAN:
        return "fan";
      case CATEGORY.GARAGE_DOOR_OPENER:
        return "garage-door";
      case CATEGORY.SWITCH:
        return "switch";
      case CATEGORY.WINDOW_COVERING:
        return "window-covering";
      case CATEGORY.SECURITY_SYSTEM:
        return "alarm";
      case CATEGORY.ALARM_SENSORS:
        return "alarm-sensors";
      case CATEGORY.SENSOR:
        return "temperature-sensor";
      case CATEGORY.WINDOW:
      case CATEGORY.DOOR:
        return "contact-sensor";
      default:
        return undefined;
    }
  })();
  return base ? narrowDeviceType(base, settings, metadata) : undefined;
};

/**
 * Apply the narrowings that used to be branched on inside the accessory setup
 * and update functions. Doing it once, here, is what keeps the registry flat and
 * stops `lightbulb` re-deriving dimmability in two places (it did so in both
 * setupLightbulb and updateLightbulb, which could drift).
 */
const narrowDeviceType = (
  deviceType: DeviceType,
  settings: ResolutionSettings,
  metadata: TydomMetaElement[],
): DeviceType => {
  if (deviceType === "switch" && settings.trigger) {
    return "trigger-switch";
  }
  if (deviceType === "temperature-sensor" && settings.smokeDetector) {
    return "smoke-detector";
  }
  if (deviceType === "temperature-sensor" && settings.sunlightSensor) {
    return "sunlight-sensor";
  }
  if (deviceType === "lightbulb") {
    // `step: 100` means the driver only does on/off, so it gets a plain
    // switchable service rather than a Brightness characteristic.
    const levelMeta = metadata.find(({ name }) => name === "level");
    return levelMeta?.step === 100 ? "lightbulb-switchable" : "lightbulb";
  }
  return deviceType;
};
