import type { PlatformAccessory, Service } from "homebridge";
import { Characteristic } from "src/config/hap";
import TydomController from "src/controller";
import { addAccessoryService, getAccessoryService, ServiceClass } from "src/helpers/accessory";
import { getTydomDataPropValue, getTydomDeviceData } from "src/helpers/tydom";
import type { TydomAccessoryContext } from "src/typings/tydom";
import { debug, debugGet, debugGetResult, debugSet, debugSetResult, debugSetUpdate } from "src/utils/debug";

export const addAccessorySwitchableService = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
  serviceClass: ServiceClass,
): Service => {
  const { context } = accessory;
  const { client } = controller;
  const { On } = Characteristic;

  const { deviceId, endpointId } = context;
  const service = addAccessoryService(accessory, serviceClass, accessory.displayName, true);

  service
    .getCharacteristic(On)
    .onGet(async () => {
      debugGet(On, service);
      try {
        const data = await getTydomDeviceData(client, { deviceId, endpointId });
        const level = getTydomDataPropValue(data, "level");
        const nextValue = level === 100;
        debugGetResult(On, service, nextValue);
        return nextValue;
      } catch (err) {
        if (err instanceof Error && err.message === "UnreacheableAccessory") {
          debug(
            `⚠️ Switchable service unreacheable for accessory with deviceId=${deviceId} and endpointId=${endpointId}`,
          );
          return false;
        }
        throw err;
      }
    })
    .onSet(async (value) => {
      debugSet(On, service, value);
      const tydomValue = value ? 100 : 0;
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "level",
          value: tydomValue,
        },
      ]);
      debugSetResult(On, service, value, tydomValue);
    });

  return service;
};

export const updateAccessorySwitchableService = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
  ServiceClass: ServiceClass,
): void => {
  updates.forEach((update) => {
    const { name, value } = update;
    const { On } = Characteristic;
    switch (name) {
      case "level": {
        const service = getAccessoryService(accessory, ServiceClass);
        const nextValue = value === 100;
        debugSetUpdate(On, service, nextValue);
        service.updateCharacteristic(On, nextValue);
        return;
      }
      default:
        return;
    }
  });
};
