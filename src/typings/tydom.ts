export type TydomConfigEndpoint = {
  id_endpoint: number;
  id_device: number;
  picto: string;
  name: string;
  first_usage: string;
  last_usage: string;
};

export type TydomConfigResponse = {
  endpoints: TydomConfigEndpoint[];
};

export type TydomMetaEndpoint = {
  id: number;
  error: number;
  metadata: Record<string, unknown>[];
};

export type TydomMetaResponse = Array<{
  id: number;
  endpoints: TydomMetaEndpoint[];
}>;

export type TydomDataElement<K = string, V = string | number | boolean> = {
  name: K;
  validity: 'expired';
  value: V;
};

export type TydomEndpointData = TydomDataElement[];

export type TydomDeviceThermostatData = [
  TydomDataElement<'authorization', 'STOP' | 'HEATING'>,
  TydomDataElement<'setpoint', number>,
  TydomDataElement<'thermicLevel', 'STOP'>,
  TydomDataElement<'hvacMode', 'NORMAL' | 'STOP' | 'ANTI_FROST'>,
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

export type TydomDeviceUpdateBody = {
  id: number;
  endpoints: {id: number; error: number; data: Record<string, unknown>[]}[];
}[];
