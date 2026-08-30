import type { AccessoryDeps } from "../src/accessories/base.js";
import type { TydomMetaElement } from "../src/api/types.js";
import { createHapStatics, FakeAccessory, type FakeService } from "./hap-double.js";

export type TydomProp = { name: string; value: unknown };
export type HapStatics = ReturnType<typeof createHapStatics>;

/**
 * Everything an accessory is handed, wired to the HAP double.
 *
 * `data` is the endpoint snapshot the gateway would answer a read with;
 * `metadata` is what discovery found, which the accessories consult for device
 * capabilities. Writes are recorded rather than sent.
 *
 * `existing` rebuilds a handler against an accessory that already exists, which
 * is what the platform does when a device's category changes.
 */
export type HarnessOptions = {
  data?: TydomProp[];
  metadata?: TydomMetaElement[];
  settings?: Record<string, unknown>;
  staleAfterMs?: number;
  existing?: { accessory: FakeAccessory; hap: HapStatics };
};

/** Build a metadata entry, with the `enum_values` capability probes read. */
export const meta = (name: string, enumValues?: string[]): TydomMetaElement => ({
  name,
  permission: "rw",
  type: "string",
  ...(enumValues ? { enum_values: enumValues } : {}),
});

export const createAccessoryHarness = (options: HarnessOptions = {}) => {
  const hap = options.existing?.hap ?? createHapStatics();
  const accessory = options.existing?.accessory ?? new FakeAccessory("Test Device", "uuid:test");
  Object.assign(accessory.context, {
    deviceId: 1,
    endpointId: 2,
    metadata: options.metadata ?? [],
    settings: options.settings ?? {},
  });

  const puts: TydomProp[][] = [];
  const commands: { name: string; body: unknown }[] = [];
  const messages: string[] = [];
  const notifications: { level: string; message: string }[] = [];
  const record = (level: string) => (message: string) => messages.push(`${level}: ${message}`);

  const deps = {
    platform: {
      Service: hap.Service,
      Characteristic: hap.Characteristic,
      config: { staleAfterMs: options.staleAfterMs ?? 0 },
      log: {
        info: record("info"),
        warn: record("warn"),
        error: record("error"),
        debug: record("debug"),
      },
    },
    accessory,
    api: {
      getDeviceData: async () => options.data ?? [],
      putDeviceData: async (_deviceId: number, _endpointId: number, values: TydomProp[]) => {
        puts.push(values);
      },
      putCommand: async (_d: number, _e: number, name: string, body: unknown) => {
        commands.push({ name, body });
      },
      runCommand: async () => [],
    },
    // The translator is identity here: what matters to a test is which label a
    // service was given, not how it reads in French.
    t: (key: string) => key,
    notify: (level: string, message: string) => notifications.push({ level, message }),
  } as unknown as AccessoryDeps;

  const serviceOf = (hapClass: { name: string }, subtype?: string): FakeService => {
    const found = subtype
      ? accessory.getServiceById(hapClass, subtype)
      : accessory.getService(hapClass);
    if (!found) {
      throw new Error(
        `No ${hapClass.name}${subtype ? ` (${subtype})` : ""} service; the accessory published: ` +
          accessory.services
            .map((s) => s.serviceName + (s.subtype ? `/${s.subtype}` : ""))
            .join(", "),
      );
    }
    return found;
  };

  return { deps, accessory, hap, puts, commands, messages, notifications, serviceOf };
};
