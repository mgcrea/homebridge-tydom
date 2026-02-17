import type { PlatformAccessory } from "homebridge";
import { toNumber } from "lodash";
import { Characteristic, Service } from "src/config/hap";
import TydomController from "src/controller";
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "src/helpers/accessory";
import { getTydomDataPropValue, getTydomDeviceData } from "src/helpers/tydom";
import { TydomAccessoryContext } from "src/typings";
import { debugGet, debugGetResult, debugSet, debugSetResult, debugSetUpdate } from "src/utils";

export const setupOutlet = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { On, OutletInUse } = Characteristic;
  const { deviceId, endpointId } = context;

  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);
  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.Outlet, accessory.displayName, true);

  service
    .getCharacteristic(On)
    .onGet(async () => {
      debugGet(On, service);
      try {
        const data = await getTydomDeviceData(client, { deviceId, endpointId });
        const plugCmd = getTydomDataPropValue(data, "plugCmd");
        const nextValue = plugCmd === "ON";
        debugGetResult(On, service, nextValue);
        return nextValue;
      } catch (err) {
        if (err instanceof Error && err.message === "UnreacheableAccessory") {
          debug2(`${(0, import_kolorist3.yellow)("⚠️ ")}Outlet unreacheable for accessory with deviceId=${deviceId} and endpointId=${endpointId}`);
          return false;
        }
        throw err;
      }
    })
    .onSet(async (value) => {
      debugSet(On, service, value);
      const tydomValue = value ? "ON" : "OFF";
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "plugCmd",
          value: tydomValue,
        },
      ]);
      debugSetResult(On, service, value, tydomValue);
    });

  service.getCharacteristic(OutletInUse).onGet(async () => {
    debugGet(OutletInUse, service);
    try {
      const data = await getTydomDeviceData(client, { deviceId, endpointId });
      const energyInstantTotElecP = getTydomDataPropValue(data, "energyInstantTotElecP");
      const nextValue = energyInstantTotElecP > 0;
      debugGetResult(OutletInUse, service, nextValue);
      return nextValue;
    } catch (err) {
      if (err instanceof Error && err.message === "UnreacheableAccessory") {
        debug2(`${(0, import_kolorist3.yellow)("⚠️ ")}Outlet unreacheable for accessory with deviceId=${deviceId} and endpointId=${endpointId}`);
        return false;
      }
      throw err;
    }
  });
};

export const updateOutlet = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
): void => {
  updates.forEach((update) => {
    const { name, value } = update;
    const { On, OutletInUse } = Characteristic;
    switch (name) {
      case "level": {
        const service = getAccessoryService(accessory, Service.Outlet);
        const nextValue = value === "ON";
        debugSetUpdate(On, service, nextValue);
        service.updateCharacteristic(On, nextValue);
        return;
      }
      case "energyInstantTotElecP": {
        const service = getAccessoryService(accessory, Service.Outlet);
        const nextValue = toNumber(value) > 0;
        debugSetUpdate(OutletInUse, service, nextValue);
        service.updateCharacteristic(OutletInUse, nextValue);
        return;
      }
      default:
        return;
    }
  });
};
