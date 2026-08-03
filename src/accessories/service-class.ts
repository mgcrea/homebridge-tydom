import type { Service, WithUUID } from "homebridge";

/** A HAP service constructor, as `accessory.addService` wants it. */
export type ServiceClass = WithUUID<typeof Service>;
