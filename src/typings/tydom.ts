import type { Categories } from "homebridge";
import type { DeviceType } from "../api/device-type.js";

type UnknownObject = Record<string, unknown>;

export type TydomAccessoryContext<
  T extends UnknownObject = UnknownObject,
  U extends UnknownObject = UnknownObject,
> = {
  accessoryId: string;
  category: Categories;
  /**
   * The registry dispatch key. Optional because a cached accessory registered
   * by an earlier release will not have one; the platform falls back to
   * deriving it from `category`.
   */
  deviceType?: DeviceType;
  /** Set on a companion accessory, naming the primary it belongs to. */
  companionOf?: string;
  deviceId: number;
  endpointId: number;
  group?: TydomConfigGroup;
  manufacturer?: string;
  metadata: TydomMetaElement[];
  model?: string;
  name: string;
  serialNumber?: string;
  settings: T;
  state: U;
};

export type TydomAccessoryUpdateContext = Pick<
  TydomAccessoryContext,
  "category" | "deviceId" | "endpointId" | "accessoryId"
>;

// Wire types live in the framework-free api layer. Imported for use by the
// device-specific aliases below, and re-exported so the accessories keep a
// single import point during the phase 6 conversion.
import type { TydomConfigGroup, TydomDataElement, TydomMetaElement } from "../api/types.js";

export type {
  AnyTydomDataValue,
  TydomConfigEndpoint,
  TydomConfigGroup,
  TydomConfigResponse,
  TydomDataElement,
  TydomEndpointData,
  TydomEndpointDataResponse,
  TydomGroupsResponse,
  TydomMetaElement,
  TydomMetaEndpoint,
  TydomMetaResponse,
} from "../api/types.js";

export type TydomDeviceThermostatAuthorization = "STOP" | "HEATING";
export type TydomDeviceThermostatHvacMode = "NORMAL" | "STOP" | "ANTI_FROST";
export type TydomDeviceThermostatThermicLevel =
  | "ECO"
  | "MODERATO"
  | "MEDIO"
  | "COMFORT"
  | "STOP"
  | "ANTI_FROST";

export type TydomDeviceThermostatData = [
  TydomDataElement<"authorization", TydomDeviceThermostatAuthorization>,
  TydomDataElement<"setpoint", number>,
  TydomDataElement<"thermicLevel", TydomDeviceThermostatThermicLevel>,
  TydomDataElement<"hvacMode", TydomDeviceThermostatHvacMode>,
  TydomDataElement<"timeDelay", number>,
  TydomDataElement<"temperature", number>,
  TydomDataElement<"tempoOn", boolean>,
  TydomDataElement<"antifrostOn", boolean>,
  TydomDataElement<"loadSheddingOn", boolean>,
  TydomDataElement<"openingDetected", boolean>,
  TydomDataElement<"presenceDetected", boolean>,
  TydomDataElement<"absence", boolean>,
  TydomDataElement<"productionDefect", boolean>,
  TydomDataElement<"batteryCmdDefect", boolean>,
  TydomDataElement<"tempSensorDefect", boolean>,
  TydomDataElement<"tempSensorShortCut", boolean>,
  TydomDataElement<"tempSensorOpenCirc", boolean>,
  TydomDataElement<"boostOn", boolean>,
];

export type TydomDeviceGarageDoorData = [TydomDataElement<"level", number>];

export type TydomDeviceShutterData = [
  TydomDataElement<"battDefect", boolean>,
  TydomDataElement<"intrusion", boolean>,
  TydomDataElement<"obstacleDefect", boolean>,
  TydomDataElement<"onFavPos", boolean>,
  TydomDataElement<"position", number>,
  TydomDataElement<"thermicDefect", boolean>,
];

export type TydomDeviceSecuritySystemAlarmState = "OFF" | "DELAYED" | "ON" | "QUIET";
export type TydomDeviceSecuritySystemAlarmMode = "OFF" | "ON" | "TEST" | "ZONE" | "MAINTENANCE";
export type TydomDeviceSecuritySystemZoneState = "UNUSED" | "ON" | "OFF";

export type TydomDeviceSecuritySystemData = [
  TydomDataElement<"alarmState", "OFF" | "DELAYED" | "ON" | "QUIET">,
  TydomDataElement<"alarmMode", TydomDeviceSecuritySystemAlarmMode>,
  TydomDataElement<"alarmTechnical", boolean>,
  TydomDataElement<"alarmSOS", boolean>,
  TydomDataElement<"unitAutoProtect", boolean>,
  TydomDataElement<"unitBatteryDefect", boolean>,
  TydomDataElement<"unackedEvent", boolean>,
  TydomDataElement<"systAutoProtect", boolean>,
  TydomDataElement<"systBatteryDefect", boolean>,
  TydomDataElement<"systSupervisionDefect", boolean>,
  TydomDataElement<"systOpenIssue", boolean>,
  TydomDataElement<"systSectorDefect", boolean>,
  TydomDataElement<"systTechnicalDefect", boolean>,
  TydomDataElement<"videoLinkDefect", boolean>,
  TydomDataElement<"remoteSurveyDefect", boolean>,
  TydomDataElement<"simDefect", boolean>,
  TydomDataElement<"networkDefect", boolean>,
  TydomDataElement<"inactiveProduct", boolean>,
  TydomDataElement<"liveCheckRunning", boolean>,
  TydomDataElement<"zone1State", TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<"zone2State", TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<"zone3State", TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<"zone4State", TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<"zone5State", TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<"zone6State", TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<"zone7State", TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<"zone8State", TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<"outTemperature", number>,
  TydomDataElement<"gsmLevel", number>,
  TydomDataElement<"kernelUpToDate", boolean>,
  TydomDataElement<"irv1State", "AVAILABLE" | "UNAVAILABLE" | "LOCKED">,
  TydomDataElement<"irv2State", "AVAILABLE" | "UNAVAILABLE" | "LOCKED">,
  TydomDataElement<"irv3State", "AVAILABLE" | "UNAVAILABLE" | "LOCKED">,
  TydomDataElement<"irv4State", "AVAILABLE" | "UNAVAILABLE" | "LOCKED">,
];

export type TydomDeviceSmokeDetectorData = [
  TydomDataElement<"techSmokeDefect", boolean>,
  TydomDataElement<"battDefect", boolean>,
];

export type TydomDeviceDataUpdateBody = {
  id: number;
  endpoints: {
    id: number;
    error: number;
    data: Record<string, unknown>[];
    cdata: Record<string, unknown>[];
  }[];
}[];

export type SecuritySystemProduct = {
  typeShort: string;
  typeLong: string;
  id: number;
  nameStd: string;
  nameCustom?: string;
  number?: number;
};

export type SecuritySystemLabelCommandResultZone = {
  id: number;
  nameStd?: string;
  nameCustom?: string;
};

export type SecuritySystemLabelCommandResult = {
  zones: SecuritySystemLabelCommandResultZone[];
  products: SecuritySystemProduct[];
};

export type SecuritySystemHistoOpenIssuesCommandResult = {
  step: number;
  nbElemTot: number;
  index: number;
  product?: SecuritySystemProduct;
};

export type SecuritySystemAlarmEvent = {
  name:
    | "arret"
    | "preAlarm"
    | "arretZone"
    | "marcheZone"
    | "marcheTotale"
    | "refusMiseEnMarche"
    | "preavisMarcheAuto"
    | "alarmIntrusion"
    | "passageEnMaintenance";
  date: string;
  zones: { id: number; nameStd: string }[];
  product?: SecuritySystemProduct;
};
