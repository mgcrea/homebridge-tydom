import type { PlatformAccessory } from "homebridge";
import { TydomAccessoryContext, TydomEndpointData } from "src/typings";
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicValue,
  NodeCallback,
  Service,
} from "../config/hap";
import TydomController from "../controller";
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "../helpers/accessory";
import { getTydomDataPropValue, getTydomDeviceData } from "../helpers/tydom";
import { debugGet, debugGetResult, debugSetUpdate } from "../utils/debug";

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
  const service = addAccessoryService(accessory, Service.ContactSensor, `${accessory.displayName}`, true);

  service
    .getCharacteristic(ContactSensorState)
    .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
      debugGet(ContactSensorState, service);
      try {
        const data = await getTydomDeviceData<TydomEndpointData>(client, { deviceId, endpointId });
        const intrusionDetect = getTydomDataPropValue<boolean>(data, "intrusionDetect");
        debugGetResult(ContactSensorState, service, intrusionDetect);
        callback(null, intrusionDetect);
      } catch (err) {
        callback(err as Error);
      }
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
