/**
 * The gateway answered, but the endpoint behind it did not.
 *
 * Transient in principle — a battery-powered device out of range, or a mains
 * device that lost power. Callers should surface it to HomeKit as "not
 * responding" rather than treating it as a plugin failure.
 */
export class UnreachableDeviceError extends Error {
  override readonly name = "UnreachableDeviceError";
  constructor(
    readonly uri: string,
    readonly code: number,
  ) {
    super(`Device at ${uri} is unreachable (error=${code})`);
  }
}

/** Any other non-zero `error` field on a Tydom response. */
export class TydomApiError extends Error {
  override readonly name = "TydomApiError";
  constructor(
    readonly uri: string,
    readonly code: number,
  ) {
    super(`${uri} reported error=${code}`);
  }
}
