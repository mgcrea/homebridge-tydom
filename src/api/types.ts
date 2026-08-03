import { z } from "zod";

/**
 * Tydom wire types.
 *
 * Framework-free by design: nothing in `src/api` may import from `homebridge`,
 * which is what lets this layer be tested without a HAP mock or a socket.
 *
 * Validation is deliberately uneven, and the split matters:
 *
 * The three *discovery* responses below are schema-checked, because everything
 * downstream depends on their shape. A firmware update that changed them would
 * otherwise surface as `TypeError: config.endpoints is not iterable` from deep
 * inside discovery — a stack trace that tells a bug reporter nothing.
 *
 * Endpoint *data* is not, beyond its envelope. It carries a device-specific,
 * open-ended `{name, value}[]`: new Delta Dore hardware ships new property
 * names constantly, and that unknown hardware is precisely the population this
 * plugin exists to onboard. A strict schema there would reject exactly the
 * devices we most want to support, so the element schema stays open.
 */

/** Schemas are permissive about extra keys — the gateway adds fields over time. */
const looseObject = z.object;

export const tydomConfigEndpointSchema = looseObject({
  id_endpoint: z.number(),
  id_device: z.number(),
  picto: z.string().default(""),
  name: z.string().default(""),
  first_usage: z.string().default(""),
  last_usage: z.string().default(""),
}).loose();
export type TydomConfigEndpoint = z.infer<typeof tydomConfigEndpointSchema>;

export const tydomConfigGroupSchema = looseObject({
  id: z.number(),
  picto: z.string().default(""),
  name: z.string().default(""),
  group_all: z.boolean().default(false),
  usage: z.string().default(""),
}).loose();
export type TydomConfigGroup = z.infer<typeof tydomConfigGroupSchema>;

/** `GET /configs/file` */
export const tydomConfigResponseSchema = looseObject({
  endpoints: z.array(tydomConfigEndpointSchema).default([]),
  groups: z.array(tydomConfigGroupSchema).default([]),
}).loose();
export type TydomConfigResponse = z.infer<typeof tydomConfigResponseSchema>;

/** `GET /groups/file` */
export const tydomGroupsResponseSchema = looseObject({
  groups: z
    .array(
      looseObject({
        id: z.number(),
        devices: z
          .array(
            looseObject({
              id: z.number(),
              endpoints: z.array(looseObject({ id: z.number() }).loose()).default([]),
            }).loose(),
          )
          .default([]),
      }).loose(),
    )
    .default([]),
}).loose();
export type TydomGroupsResponse = z.infer<typeof tydomGroupsResponseSchema>;

export const tydomMetaElementSchema = looseObject({
  name: z.string(),
  // `permission` and `type` are left as plain strings rather than enums: a new
  // firmware introducing a fourth type must not make the whole device
  // undiscoverable.
  permission: z.string().default("r"),
  type: z.string().default("string"),
  enum_values: z.array(z.string()).optional(),
  max: z.number().optional(),
  min: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().optional(),
}).loose();
export type TydomMetaElement = z.infer<typeof tydomMetaElementSchema>;

export const tydomMetaEndpointSchema = looseObject({
  id: z.number(),
  error: z.number().default(0),
  metadata: z.array(tydomMetaElementSchema).default([]),
}).loose();
export type TydomMetaEndpoint = z.infer<typeof tydomMetaEndpointSchema>;

/** `GET /devices/meta` */
export const tydomMetaResponseSchema = z.array(
  looseObject({
    id: z.number(),
    endpoints: z.array(tydomMetaEndpointSchema).default([]),
  }).loose(),
);
export type TydomMetaResponse = z.infer<typeof tydomMetaResponseSchema>;

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

/**
 * Raised when a discovery response does not match its schema.
 *
 * Deliberately loud: this is the one class of failure where carrying on would
 * mean silently unregistering every one of the user's accessories.
 */
export class TydomSchemaError extends Error {
  override readonly name = "TydomSchemaError";
  constructor(
    readonly uri: string,
    readonly detail: string,
  ) {
    super(`${uri} returned an unexpected shape: ${detail}`);
  }
}

/** Parse a discovery response, or fail with a message naming the endpoint. */
export const parseDiscoveryResponse = <T>(
  uri: string,
  schema: z.ZodType<T>,
  payload: unknown,
): T => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new TydomSchemaError(uri, z.prettifyError(result.error).slice(0, 300));
  }
  return result.data;
};
