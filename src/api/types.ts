/**
 * Tydom wire types.
 *
 * Framework-free by design: nothing in `src/api` may import from `homebridge`,
 * which is what lets this layer be tested without a HAP mock or a socket.
 */

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
  groups: { id: number; devices: { id: number; endpoints: { id: number }[] }[] }[];
};

export type TydomMetaElement = {
  enum_values?: string[];
  max?: number;
  min?: number;
  name: string;
  permission: "r" | "w" | "rw";
  step?: number;
  type: "boolean" | "string" | "numeric";
  unit?: "boolean" | "%";
};

export type TydomMetaEndpoint = {
  id: number;
  error: number;
  metadata: TydomMetaElement[];
};

export type TydomMetaResponse = {
  id: number;
  endpoints: TydomMetaEndpoint[];
}[];

export type AnyTydomDataValue = string | number | boolean;

export type TydomDataElement<K = string, V = AnyTydomDataValue> = {
  name: K;
  validity: "expired" | "upToDate";
  value: V;
};

export type TydomEndpointDataResponse = { error: number; data: TydomDataElement[] };
export type TydomEndpointData = TydomDataElement[];

/** Whether an update carried device data or the result of a device command. */
export type TydomUpdateType = "data" | "cdata";
