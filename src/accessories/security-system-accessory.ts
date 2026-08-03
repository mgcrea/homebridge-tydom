import { getTydomDataPropValue } from "../api/types.js";
import type { Service } from "homebridge";
import type { TydomUpdateType } from "../api/types.js";
import {
  debug,
  debugAddSubService,
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
} from "../platform/trace.js";
import type {
  SecuritySystemAlarmEvent,
  SecuritySystemLabelCommandResult,
  SecuritySystemLabelCommandResultZone,
  TydomDeviceSecuritySystemData,
  TydomDeviceSecuritySystemZoneState,
} from "../typings/tydom.js";
import { styleJson, styleKeyword } from "../util/style.js";
import { BaseAccessory } from "./base-accessory.js";
import type { AccessoryDeps } from "./base.js";
import {
  ALARM_STATE,
  getActiveZones,
  getStateForActiveZones,
  getStateForAlarmData,
  type AlarmSettings,
} from "./security-system-state.js";

/** A TYXAL+ or CTX60 alarm panel. */
export class SecuritySystemAccessory extends BaseAccessory {
  readonly #settings: AlarmSettings;
  readonly #legacy: boolean;
  readonly #pin: string | undefined;

  #service: Service | undefined;
  #systOpenIssue: Service | undefined;
  #alarmSOS: Service | undefined;
  #preAlarm: Service | undefined;
  /** Zone switches, by the 1-based zone index they command. */
  readonly #zones = new Map<number, Service>();

  constructor(deps: AccessoryDeps) {
    super(deps);
    this.#settings = this.accessory.context.settings as AlarmSettings;
    this.#legacy = this.#settings.legacy ?? false;
    this.#pin = this.#settings.pin ?? this.platform.config.pin;

    if (!this.#pin) {
      this.platform.log.warn(
        `Missing pin for device securitySystem, add either {"settings": {"${this.deviceId}": {"pin": "123456"}}} or HOMEBRIDGE_TYDOM_PIN env var (base64 encoded)`,
      );
    }
  }

  /** Kick off setup and expose it as the readiness gate. */
  start(): void {
    this.ready = this.setup().catch((err: unknown) => {
      this.platform.log.error(`Failed to set up ${this.name}: ${String(err)}`);
    });
  }

  /**
   * Query the panel and build its services.
   *
   * Separate from the constructor because it needs two round trips — the zone
   * labels and the initial state — and a constructor cannot await.
   */
  async setup(): Promise<void> {
    const { Characteristic, Service: Services } = this.platform;
    const { SecuritySystemTargetState, SecuritySystemCurrentState, StatusTampered } =
      Characteristic;

    const initialData = await this.read<TydomDeviceSecuritySystemData>();
    const zones = await this.#readZoneLabels();

    const service = this.service(Services.SecuritySystem);
    this.#service = service;

    service
      .getCharacteristic(SecuritySystemCurrentState)
      // Default to disarmed so a restart cannot look like a triggered alarm.
      .updateValue(SecuritySystemCurrentState.DISARMED)
      .onGet(async () => {
        debugGet(SecuritySystemCurrentState, service);
        const nextValue = await this.#currentState();
        debugGetResult(SecuritySystemCurrentState, service, nextValue);
        return nextValue;
      });

    service.getCharacteristic(StatusTampered).onGet(async () => {
      debugGet(StatusTampered, service);
      const data = await this.#read();
      const value = getTydomDataPropValue<boolean>(data, "systAutoProtect");
      debugGetResult(StatusTampered, service, value);
      return value;
    });

    service
      .getCharacteristic(SecuritySystemTargetState)
      .onGet(async () => {
        debugGet(SecuritySystemTargetState, service);
        const nextValue = await this.#currentState();
        debugGetResult(SecuritySystemTargetState, service, nextValue);
        return nextValue;
      })
      .onSet(async (value) => {
        debugSet(SecuritySystemTargetState, service, value);
        await this.#arm(value as number);
      });

    this.#systOpenIssue = this.#addContactSensor(
      "systOpenIssue",
      this.t("ALARME_ISSUES_OUVERTES"),
      async () => getTydomDataPropValue<boolean>(await this.#read(), "systOpenIssue"),
    );
    this.#alarmSOS = this.#addContactSensor("alarmSOS", this.t("DISCRETE_ALARM_V3"), async () =>
      getTydomDataPropValue<boolean>(await this.#read(), "alarmSOS"),
    );
    // No getter: preAlarm is event-driven, set by an eventAlarm cdata push and
    // cleared when the user disarms.
    this.#preAlarm = this.#addContactSensor("preAlarm", this.t("PREALARM"));
    this.#preAlarm.getCharacteristic(Characteristic.ContactSensorState).updateValue(false);

    this.#setupZones(initialData, zones);
  }

  protected override apply(updates: Record<string, unknown>[], type: TydomUpdateType): void {
    // Services may not exist yet: setup needs two round trips, and the gateway
    // pushes before it finishes.
    void this.ready.then(() => {
      if (type === "cdata") {
        this.#handleEvents(updates);
      } else {
        this.#handleData(updates);
      }
      return undefined;
    });
  }

  // ---------------------------------------------------------------- internals

  async #read(): Promise<TydomDeviceSecuritySystemData> {
    return this.read<TydomDeviceSecuritySystemData>();
  }

  async #currentState(): Promise<number> {
    const data = await this.#read();
    return getStateForAlarmData(data, this.#settings.aliases ?? {}, this.#settings);
  }

  async #readZoneLabels(): Promise<SecuritySystemLabelCommandResultZone[]> {
    if (this.#legacy) {
      this.platform.log.warn(`Setting up legacy zones`);
      return [0, 1, 2, 3].map((id) => ({ id, nameCustom: `Zone ${id + 1}` }));
    }
    try {
      const results = await this.api.runCommand<SecuritySystemLabelCommandResult>(
        this.deviceId,
        this.endpointId,
        "label",
      );
      return results[0]?.zones ?? [];
    } catch {
      this.platform.log.warn(`Failed to query labels for security system`);
      return [];
    }
  }

  #addContactSensor(subtype: string, name: string, read?: () => Promise<boolean>): Service {
    const { Characteristic, Service: Services } = this.platform;
    const service = this.subService(Services.ContactSensor, name, subtype);
    debugAddSubService(service, this.accessory);
    this.#service?.addLinkedService(service);
    if (read) {
      service.getCharacteristic(Characteristic.ContactSensorState).onGet(async () => {
        debugGet(Characteristic.ContactSensorState, service);
        const value = await read();
        debugGetResult(Characteristic.ContactSensorState, service, value);
        return value;
      });
    }
    service.getCharacteristic(Characteristic.StatusActive).updateValue(true);
    service.getCharacteristic(Characteristic.StatusFault).updateValue(false);
    return service;
  }

  #setupZones(
    initialData: TydomDeviceSecuritySystemData,
    zones: SecuritySystemLabelCommandResultZone[],
  ): void {
    const { Characteristic, Service: Services } = this.platform;
    const { On } = Characteristic;
    const zonesCount = this.#legacy ? 4 : 8;

    for (let zoneIndex = 1; zoneIndex <= zonesCount; zoneIndex += 1) {
      const zoneProp = `${this.#legacy ? "part" : "zone"}${zoneIndex}State`;
      const zoneState = initialData.find((prop) => prop.name === zoneProp)?.value;
      if (zoneState === "UNUSED" || zoneState === undefined) {
        continue;
      }
      const zone = zones[zoneIndex - 1];
      if (!zone) {
        // A panel can report an in-use zone the label command did not describe;
        // that is not a reason to drop it.
        this.platform.log.warn(`Missing zone label data for index ${zoneIndex}, using a default`);
      }
      const name = zone?.nameCustom ?? (zone?.nameStd ? this.t(zone.nameStd) : `Zone ${zoneIndex}`);
      const service = this.subService(Services.Switch, name, `zone_${zone?.id ?? zoneIndex}`);
      debugAddSubService(service, this.accessory);
      this.#service?.addLinkedService(service);
      this.#zones.set(zoneIndex, service);

      service
        .getCharacteristic(On)
        .onGet(async () => {
          debugGet(On, service);
          const data = await this.#read();
          const state = getTydomDataPropValue<TydomDeviceSecuritySystemZoneState>(data, zoneProp);
          const nextValue = state === "ON";
          debugGetResult(On, service, nextValue);
          return nextValue;
        })
        .onSet(async (value) => {
          debugSet(On, service, value);
          if (!this.#pin) {
            return;
          }
          const tydomValue = value ? "ON" : "OFF";
          await this.#setZones([zoneIndex], tydomValue);
          debugSetResult(On, service, value, tydomValue);
        });
    }
  }

  async #arm(target: number): Promise<void> {
    const { SecuritySystemTargetState, ContactSensorState } = this.platform.Characteristic;
    if (!this.#pin) {
      return;
    }
    if (target === SecuritySystemTargetState.DISARM) {
      this.#preAlarm?.updateCharacteristic(ContactSensorState, false);
    }

    if (
      target === SecuritySystemTargetState.AWAY_ARM ||
      target === SecuritySystemTargetState.DISARM
    ) {
      const tydomValue = target === SecuritySystemTargetState.DISARM ? "OFF" : "ON";
      if (this.#legacy) {
        for (const part of [1, 2, 3, 4]) {
          await this.api.putCommand(this.deviceId, this.endpointId, "partCmd", {
            value: tydomValue,
            part,
          });
        }
      } else {
        await this.api.putCommand(this.deviceId, this.endpointId, "alarmCmd", {
          value: tydomValue,
          pwd: this.#pin,
        });
      }
      if (this.#service) {
        debugSetResult(SecuritySystemTargetState, this.#service, target, tydomValue);
      }
      return;
    }

    const aliases = this.#settings.aliases ?? {};
    const targetZones =
      target === SecuritySystemTargetState.STAY_ARM ? aliases.stay : aliases.night;
    if (Array.isArray(targetZones) && targetZones.length > 0) {
      await this.#setZones(targetZones, "ON");
      if (this.#service) {
        debugSetResult(SecuritySystemTargetState, this.#service, target, "ON");
      }
    }
  }

  async #setZones(zoneIds: number[], value: "ON" | "OFF"): Promise<void> {
    if (!this.#legacy) {
      await this.api.putCommand(this.deviceId, this.endpointId, "zoneCmd", {
        value,
        pwd: this.#pin,
        zones: zoneIds,
      });
      return;
    }
    // Legacy panels have no bulk zone command; they address one part at a time.
    for (const part of zoneIds) {
      await this.api.putCommand(this.deviceId, this.endpointId, "partCmd", { value, part });
    }
  }

  #handleData(updates: Record<string, unknown>[]): void {
    const { SecuritySystemCurrentState, ContactSensorState, On } = this.platform.Characteristic;
    const aliases = this.#settings.aliases ?? {};

    for (const { name, value } of updates) {
      if (name === "alarmMode") {
        const nextValue =
          value === "OFF"
            ? ALARM_STATE.DISARMED
            : value === "ON"
              ? ALARM_STATE.AWAY_ARM
              : value === "PART" || value === "ZONE"
                ? getStateForActiveZones(getActiveZones(updates as never, this.#settings), aliases)
                : undefined;
        if (nextValue !== undefined && this.#service) {
          debugSetUpdate(SecuritySystemCurrentState, this.#service, nextValue);
          this.#service.updateCharacteristic(SecuritySystemCurrentState, nextValue);
        }
        continue;
      }

      if (name === "alarmSOS" && this.#alarmSOS) {
        debugSetUpdate(ContactSensorState, this.#alarmSOS, Boolean(value));
        this.#alarmSOS.updateCharacteristic(ContactSensorState, Boolean(value));
        continue;
      }

      if (name === "systOpenIssue" && this.#systOpenIssue) {
        debugSetUpdate(ContactSensorState, this.#systOpenIssue, Boolean(value));
        this.#systOpenIssue.updateCharacteristic(ContactSensorState, Boolean(value));
        continue;
      }

      const zoneMatch = /^(?:zone|part)([1-8])State$/.exec(String(name));
      if (zoneMatch?.[1]) {
        if (value === "UNUSED") {
          continue;
        }
        const service = this.#zones.get(Number(zoneMatch[1]));
        if (service) {
          const nextValue = value === "ON";
          debugSetUpdate(On, service, nextValue);
          service.updateCharacteristic(On, nextValue);
        }
      }
    }
  }

  #handleEvents(updates: Record<string, unknown>[]): void {
    const { ContactSensorState } = this.platform.Characteristic;
    const aliases = this.#settings.aliases ?? {};

    for (const update of updates) {
      const { name, parameters, values } = update as {
        name?: string;
        parameters?: unknown;
        values?: { event?: SecuritySystemAlarmEvent };
      };

      if (name !== "eventAlarm") {
        this.notify(
          "debug",
          `SecuritySystem \`${String(name)}\` event parameters=\`${JSON.stringify(parameters)}\`, values=\`${JSON.stringify(values)}\``,
        );
        continue;
      }

      const event = values?.event;
      if (!event) {
        continue;
      }
      debug(`New ${styleKeyword("SecuritySystem")} alarm event=${styleJson(event)}`);
      this.notify(
        "warn",
        `SecuritySystem \`${name}\` event, name=\`${event.name}\` parameters=\`${JSON.stringify(parameters)}\`, values=\`${JSON.stringify(values)}\``,
      );

      switch (event.name) {
        case "arret":
          this.#setState(ALARM_STATE.DISARMED);
          break;
        case "marcheTotale":
          this.#setState(ALARM_STATE.AWAY_ARM);
          break;
        case "marcheZone": {
          const activeZones = event.zones.map((zone) => zone.id + 1);
          this.#setState(getStateForActiveZones(activeZones, aliases));
          break;
        }
        case "preAlarm": {
          if (this.#preAlarm) {
            debugSetUpdate(ContactSensorState, this.#preAlarm, true);
            this.#preAlarm.updateCharacteristic(ContactSensorState, true);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  #setState(state: number): void {
    if (!this.#service) {
      return;
    }
    const { SecuritySystemCurrentState } = this.platform.Characteristic;
    debugSetUpdate(SecuritySystemCurrentState, this.#service, state);
    this.#service.updateCharacteristic(SecuritySystemCurrentState, state);
  }
}

export const createSecuritySystemAccessory = (deps: AccessoryDeps): SecuritySystemAccessory => {
  const accessory = new SecuritySystemAccessory(deps);
  accessory.start();
  return accessory;
};
