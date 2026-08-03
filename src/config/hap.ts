import type { HAP, API as Homebridge } from "homebridge";

export type { CharacteristicProps, VoidCallback } from "homebridge";

/**
 * HAP's constructor namespaces, captured once at plugin registration.
 *
 * `api.hap.Service` and `api.hap.Characteristic` are process singletons, so
 * these are the very same objects the platform exposes as `platform.Service` /
 * `platform.Characteristic`. That equivalence is what lets the class-based
 * accessories introduced in phase 6 coexist with the function-pair modules that
 * still read these globals — both end up at the same references.
 *
 * Deleted at the end of phase 6, once nothing reads them.
 *
 * Note what is deliberately *not* re-exported here any more: `Categories`,
 * `Formats` and `AccessoryEventTypes`. hap-nodejs declares those as ambient
 * `const enum`s, which `isolatedModules` and `verbatimModuleSyntax` forbid
 * referencing, and re-exporting them also forced `homebridge` into the built
 * bundle's runtime requires. Their values live in api/device-type.ts (category
 * numbers) or are written as the string literals they actually are.
 */
export let Characteristic: HAP["Characteristic"];
export let Service: HAP["Service"];

export const defineHAPGlobals = (homebridge: Homebridge): void => {
  Characteristic = homebridge.hap.Characteristic;
  Service = homebridge.hap.Service;
};
