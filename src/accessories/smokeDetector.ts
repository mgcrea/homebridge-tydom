import type { PlatformAccessory } from "homebridge";
import { Formats } from "homebridge";
import { Characteristic, Service } from "src/config/hap";
import TydomController from "src/controller";
import {
  addAccessoryService,
  getAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "src/helpers/accessory";
import { getTydomDataPropValue, getTydomDeviceData } from "src/helpers/tydom";
import type { TydomAccessoryContext, TydomDeviceSmokeDetectorData } from "src/typings/tydom";
import { debugGet, debugGetResult, debugSetUpdate } from "src/utils/debug";

export const setupSmokeDetector = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;
  const { SmokeDetected, StatusLowBattery } = Characteristic;

  const { deviceId, endpointId } = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.SmokeSensor, accessory.displayName, true);

  service
    .getCharacteristic(SmokeDetected)
    .setProps({
      format: Formats.BOOL,
    })
    .onGet(async () => {
      debugGet(SmokeDetected, service);
      const data = await getTydomDeviceData<TydomDeviceSmokeDetectorData>(client, { deviceId, endpointId });
      const smokeDefect = getTydomDataPropValue<boolean>(data, "techSmokeDefect");
      debugGetResult(SmokeDetected, service, smokeDefect);
      return smokeDefect;
    });

  service.getCharacteristic(StatusLowBattery).onGet(async () => {
    debugGet(StatusLowBattery, service);
    const data = await getTydomDeviceData<TydomDeviceSmokeDetectorData>(client, { deviceId, endpointId });
    const battDefect = getTydomDataPropValue<boolean>(data, "battDefect");
    debugGetResult(StatusLowBattery, service, battDefect);
    return battDefect ? StatusLowBattery.BATTERY_LEVEL_LOW : StatusLowBattery.BATTERY_LEVEL_NORMAL;
  });
};

export const updateSmokeDetector = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  _controller: TydomController,
  updates: Record<string, unknown>[],
): void => {
  updates.forEach((update) => {
    const { name, value } = update;
    const { SmokeDetected, StatusLowBattery } = Characteristic;
    switch (name) {
      case "techSmokeDefect": {
        const service = getAccessoryService(accessory, Service.SmokeSensor);
        debugSetUpdate(SmokeDetected, service, value);
        service.updateCharacteristic(SmokeDetected, value as boolean);
        return;
      }
      case "battDefect": {
        const service = getAccessoryService(accessory, Service.SmokeSensor);
        debugSetUpdate(StatusLowBattery, service, value);
        service.updateCharacteristic(StatusLowBattery, value as number);
        return;
      }
      default:
        return;
    }
  });
};
