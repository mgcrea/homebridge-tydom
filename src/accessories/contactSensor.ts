import type { PlatformAccessory } from "homebridge";
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
import { debugGet, debugGetResult, debugSetUpdate } from "src/utils/debug";

export const setupContactSensor = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { ContactSensorState } = Characteristic;

  const { deviceId, endpointId } = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.ContactSensor, accessory.displayName, true);

  service.getCharacteristic(ContactSensorState).onGet(async () => {
    debugGet(ContactSensorState, service);
    const data = await getTydomDeviceData(client, { deviceId, endpointId });
    const intrusionDetect = getTydomDataPropValue<boolean>(data, "intrusionDetect");
    debugGetResult(ContactSensorState, service, intrusionDetect);
    return intrusionDetect;
  });
};

export const updateContactSensor = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
): void => {
  updates.forEach((update) => {
    const { name, value } = update;
    const { ContactSensorState } = Characteristic;
    switch (name) {
      case "intrusionDetect": {
        const service = getAccessoryService(accessory, Service.ContactSensor);
        debugSetUpdate(ContactSensorState, service, value);
        service.updateCharacteristic(ContactSensorState, value as boolean);
        return;
      }
      default:
        return;
    }
  });
};
