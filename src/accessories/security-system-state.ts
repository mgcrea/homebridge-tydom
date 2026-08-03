import type { TydomEndpointData } from "../api/types.js";
import { asNumber, sameArrays } from "../util/basic.js";

/**
 * HAP's `SecuritySystemCurrentState` values.
 *
 * Written down rather than read off `Characteristic`, so this whole module is
 * pure and testable without HAP. The numbers are part of the HomeKit protocol
 * and do not change.
 */
export const ALARM_STATE = {
  STAY_ARM: 0,
  AWAY_ARM: 1,
  NIGHT_ARM: 2,
  DISARMED: 3,
  ALARM_TRIGGERED: 4,
} as const;

export type AlarmStateValue = (typeof ALARM_STATE)[keyof typeof ALARM_STATE];

export type ZoneAliases = {
  stay?: number[];
  night?: number[];
};

export type AlarmSettings = {
  legacy?: boolean;
  aliases?: ZoneAliases;
  sensors?: boolean;
  pin?: string;
};

/**
 * Which zones are currently armed.
 *
 * Legacy panels (CTX60) expose `part1State`..`part4State`; everything else
 * exposes `zone1State`..`zone8State`.
 */
export const getActiveZones = (alarmData: TydomEndpointData, settings: AlarmSettings): number[] => {
  const pattern = settings.legacy ? /part([1-4])State/i : /zone([1-8])State/i;
  const active: number[] = [];
  for (const { name, value } of alarmData) {
    const matches = pattern.exec(name);
    if (matches?.[1] && value === "ON") {
      active.push(asNumber(matches[1]));
    }
  }
  return active;
};

/**
 * Map an armed-zone set onto a HomeKit state.
 *
 * HomeKit has three armed modes; Tydom has arbitrary zone combinations. The
 * user declares which combination means "stay" and which means "night" via
 * `settings.<deviceId>.aliases`; anything else reads as disarmed, because
 * claiming AWAY_ARM for a partial arm would be worse than saying nothing.
 */
export const getStateForActiveZones = (
  activeZones: number[],
  aliases: ZoneAliases,
): AlarmStateValue => {
  if (aliases.stay && sameArrays(activeZones, aliases.stay)) {
    return ALARM_STATE.STAY_ARM;
  }
  if (aliases.night && sameArrays(activeZones, aliases.night)) {
    return ALARM_STATE.NIGHT_ARM;
  }
  return ALARM_STATE.DISARMED;
};

/**
 * Whether one zone is armed, given the panel's overall mode.
 *
 * The mode outranks the per-zone property. A panel does not always volunteer
 * every `zoneNState` when it disarms — sometimes it sends `alarmMode: "OFF"`
 * and nothing else — which used to leave a zone switch reading `"ON"` from the
 * last thing the panel happened to say about it. Since a disarmed system has no
 * armed zones by definition, and a fully armed one has nothing but, the mode
 * answers for both.
 */
export const isZoneArmed = (alarmData: TydomEndpointData, zoneProp: string): boolean => {
  const alarmMode = alarmData.find((prop) => prop.name === "alarmMode")?.value;
  if (alarmMode === "OFF") {
    return false;
  }
  if (alarmMode === "ON") {
    return true;
  }
  return alarmData.find((prop) => prop.name === zoneProp)?.value === "ON";
};

/** The HomeKit state for a full alarm data snapshot. */
export const getStateForAlarmData = (
  alarmData: TydomEndpointData,
  aliases: ZoneAliases,
  settings: AlarmSettings,
): AlarmStateValue => {
  const find = (name: string): unknown => alarmData.find((prop) => prop.name === name)?.value;
  const alarmState = find("alarmState");
  const alarmMode = find("alarmMode");

  if (typeof alarmState === "string" && ["DELAYED", "ON", "QUIET"].includes(alarmState)) {
    return ALARM_STATE.ALARM_TRIGGERED;
  }
  if (alarmMode === "ON") {
    return ALARM_STATE.AWAY_ARM;
  }
  if (typeof alarmMode === "string" && ["ZONE", "PART"].includes(alarmMode)) {
    return getStateForActiveZones(getActiveZones(alarmData, settings), aliases);
  }
  return ALARM_STATE.DISARMED;
};
