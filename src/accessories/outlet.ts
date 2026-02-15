import {
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  PlatformAccessory,
} from "homebridge";
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
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(On, service);
      try {
        const data = await getTydomDeviceData(client, { deviceId, endpointId });
        const plugCmd = getTydomDataPropValue<string>(data, "plugCmd");
        const nextValue = plugCmd === "ON";
        debugGetResult(On, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
      }
    })
    .on(
      CharacteristicEventTypes.SET,
      async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        debugSet(On, service, value);
        try {
          const tydomValue = value ? "ON" : "OFF";
          await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
            {
              name: "plugCmd",
              value: tydomValue,
            },
          ]);
          debugSetResult(On, service, value, tydomValue);
          callback();
        } catch (err) {
          callback(err as Error);
        }
      },
    );

  service
    .getCharacteristic(OutletInUse)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(OutletInUse, service);
      try {
        const data = await getTydomDeviceData(client, { deviceId, endpointId });
        const energyInstantTotElecP = getTydomDataPropValue<number>(data, "energyInstantTotElecP");
        const nextValue = energyInstantTotElecP > 0;
        debugGetResult(OutletInUse, service, nextValue);
        callback(null, nextValue);
      } catch (err) {
        callback(err as Error);
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
