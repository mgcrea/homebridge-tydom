import type { PlatformAccessory, Service } from "homebridge";
import { Characteristic } from "../../config/hap.js";
import type TydomController from "../../controller.js";
import type { ServiceClass } from "../../helpers/accessory.js";
import { addAccessoryService, getAccessoryService } from "../../helpers/accessory.js";
import { getTydomDataPropValue, getTydomDeviceData } from "../../helpers/tydom.js";
import type { TydomAccessoryContext } from "../../typings/tydom.js";
import {
  debugGet,
  debugGetResult,
  debugSet,
  debugSetResult,
  debugSetUpdate,
} from "../../utils/debug.js";

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
      const data = await getTydomDeviceData(client, { deviceId, endpointId });
      const level = getTydomDataPropValue<number>(data, "level");
      const nextValue = level === 100;
      debugGetResult(On, service, nextValue);
      return nextValue;
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
