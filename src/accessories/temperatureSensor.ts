import type { PlatformAccessory } from "homebridge";
import { Characteristic, Service } from "../config/hap.js";
import type TydomController from "../controller.js";
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "../helpers/accessory.js";
import { getTydomDataPropValue, getTydomDeviceData } from "../helpers/tydom.js";
import type { TydomAccessoryContext } from "../typings/tydom.js";
import { debugGet, debugGetResult, debugSetUpdate } from "../platform/trace.js";

export const setupTemperatureSensor = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { CurrentTemperature } = Characteristic;

  const { deviceId, endpointId } = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(
    accessory,
    Service.TemperatureSensor,
    accessory.displayName,
    true,
  );

  service
    .getCharacteristic(CurrentTemperature)
    .setProps({
      minValue: -100,
    })
    .onGet(async () => {
      debugGet(CurrentTemperature, service);
      const data = await getTydomDeviceData(client, { deviceId, endpointId });
      const outTemperature = getTydomDataPropValue<number>(data, "outTemperature");
      debugGetResult(CurrentTemperature, service, outTemperature);
      return outTemperature;
    });
};

export const updateTemperatureSensor = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
): void => {
  updates.forEach((update) => {
    const { name, value } = update;
    const { CurrentTemperature } = Characteristic;
    switch (name) {
      case "outTemperature": {
        const service = getAccessoryService(accessory, Service.TemperatureSensor);
        debugSetUpdate(CurrentTemperature, service, value);
        service.updateCharacteristic(CurrentTemperature, value as number);
        return;
      }
      default:
        return;
    }
  });
};
