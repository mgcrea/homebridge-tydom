export type TydomConfigEndpoint = {
  id_endpoint: number;
  id_device: number;
  picto: string;
  name: string;
  first_usage: string;
  last_usage: string;
};

export type TydomConfigGroup = {
  picto: string;
  name: string;
  group_all: boolean;
  usage: string;
  id: number;
};

export type TydomConfigResponse = {
  endpoints: TydomConfigEndpoint[];
  groups: TydomConfigGroup[];
};

export type TydomGroupsResponse = {
  groups: Array<{id: number; devices: Array<{id: number; endpoints: Array<{id: number}>}>}>;
};

export type TydomMetaElement = {
  enum_values?: string[];
  max?: number;
  min?: number;
  name: string;
  permission: 'r' | 'w' | 'rw';
  step?: number;
  type: 'boolean' | 'string' | 'numeric';
  unit?: 'boolean' | '%';
};

export type TydomMetaEndpoint = {
  id: number;
  error: number;
  metadata: TydomMetaElement[];
};

export type TydomMetaResponse = Array<{
  id: number;
  endpoints: TydomMetaEndpoint[];
}>;

export type AnyTydomDataValue = string | number | boolean;

export type TydomDataElement<K = string, V = AnyTydomDataValue> = {
  name: K;
  validity: 'expired';
  value: V;
};

export type TydomEndpointDataResponse = {error: number; data: TydomDataElement[]};
export type TydomEndpointData = TydomDataElement[];
export type TydomDeviceThermostatAuthorization = 'STOP' | 'HEATING';
export type TydomDeviceThermostatHvacMode = 'NORMAL' | 'STOP' | 'ANTI_FROST';
export type TydomDeviceThermostatThermicLevel = 'ECO' | 'MODERATO' | 'MEDIO' | 'COMFORT' | 'STOP' | 'ANTI_FROST';

export type TydomDeviceThermostatData = [
  TydomDataElement<'authorization', TydomDeviceThermostatAuthorization>,
  TydomDataElement<'setpoint', number>,
  TydomDataElement<'thermicLevel', TydomDeviceThermostatThermicLevel>,
  TydomDataElement<'hvacMode', TydomDeviceThermostatHvacMode>,
  TydomDataElement<'timeDelay', number>,
  TydomDataElement<'temperature', number>,
  TydomDataElement<'tempoOn', boolean>,
  TydomDataElement<'antifrostOn', boolean>,
  TydomDataElement<'loadSheddingOn', boolean>,
  TydomDataElement<'openingDetected', boolean>,
  TydomDataElement<'presenceDetected', boolean>,
  TydomDataElement<'absence', boolean>,
  TydomDataElement<'productionDefect', boolean>,
  TydomDataElement<'batteryCmdDefect', boolean>,
  TydomDataElement<'tempSensorDefect', boolean>,
  TydomDataElement<'tempSensorShortCut', boolean>,
  TydomDataElement<'tempSensorOpenCirc', boolean>,
  TydomDataElement<'boostOn', boolean>
];

export type TydomDeviceShutterData = [
  TydomDataElement<'battDefect', boolean>,
  TydomDataElement<'intrusion', boolean>,
  TydomDataElement<'obstacleDefect', boolean>,
  TydomDataElement<'onFavPos', boolean>,
  TydomDataElement<'position', number>,
  TydomDataElement<'thermicDefect', boolean>
];

export type TydomDeviceSecuritySystemAlarmState = 'OFF' | 'DELAYED' | 'ON' | 'QUIET';
export type TydomDeviceSecuritySystemAlarmMode = 'OFF' | 'ON' | 'TEST' | 'ZONE' | 'MAINTENANCE';
export type TydomDeviceSecuritySystemZoneState = 'UNUSED' | 'ON' | 'OFF';

export type TydomDeviceSecuritySystemData = [
  TydomDataElement<'alarmState', 'OFF' | 'DELAYED' | 'ON' | 'QUIET'>,
  TydomDataElement<'alarmMode', TydomDeviceSecuritySystemAlarmMode>,
  TydomDataElement<'alarmTechnical', boolean>,
  TydomDataElement<'alarmSOS', boolean>,
  TydomDataElement<'unitAutoProtect', boolean>,
  TydomDataElement<'unitBatteryDefect', boolean>,
  TydomDataElement<'unackedEvent', boolean>,
  TydomDataElement<'systAutoProtect', boolean>,
  TydomDataElement<'systBatteryDefect', boolean>,
  TydomDataElement<'systSupervisionDefect', boolean>,
  TydomDataElement<'systOpenIssue', boolean>,
  TydomDataElement<'systSectorDefect', boolean>,
  TydomDataElement<'systTechnicalDefect', boolean>,
  TydomDataElement<'videoLinkDefect', boolean>,
  TydomDataElement<'remoteSurveyDefect', boolean>,
  TydomDataElement<'simDefect', boolean>,
  TydomDataElement<'networkDefect', boolean>,
  TydomDataElement<'inactiveProduct', boolean>,
  TydomDataElement<'liveCheckRunning', boolean>,
  TydomDataElement<'zone1State', TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<'zone2State', TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<'zone3State', TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<'zone4State', TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<'zone5State', TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<'zone6State', TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<'zone7State', TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<'zone8State', TydomDeviceSecuritySystemZoneState>,
  TydomDataElement<'outTemperature', number>,
  TydomDataElement<'gsmLevel', number>,
  TydomDataElement<'kernelUpToDate', boolean>,
  TydomDataElement<'irv1State', 'AVAILABLE' | 'UNAVAILABLE' | 'LOCKED'>,
  TydomDataElement<'irv2State', 'AVAILABLE' | 'UNAVAILABLE' | 'LOCKED'>,
  TydomDataElement<'irv3State', 'AVAILABLE' | 'UNAVAILABLE' | 'LOCKED'>,
  TydomDataElement<'irv4State', 'AVAILABLE' | 'UNAVAILABLE' | 'LOCKED'>
];

export type TydomDeviceDataUpdateBody = {
  id: number;
  endpoints: {id: number; error: number; data: Record<string, unknown>[]}[];
}[];

export type SecuritySystemProduct = {
  typeShort: string;
  typeLong: string;
  id: number;
  nameStd: string;
  nameCustom?: string;
  number?: number;
};

export type SecuritySystemLabelCommandResult = {
  zones: {
    id: number;
    nameStd?: string;
    nameCustom?: string;
  }[];
  products: SecuritySystemProduct[];
};

export type SecuritySystemHistoOpenIssuesCommandResult = {
  step: number;
  nbElemTot: number;
  index: number;
  product?: SecuritySystemProduct;
};
