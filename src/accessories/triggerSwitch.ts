import type { PlatformAccessory } from "homebridge";
import { Characteristic, Service } from "../config/hap.js";
import type TydomController from "../controller.js";
import {
  addAccessoryService,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
} from "../helpers/accessory.js";
import type { TydomAccessoryContext } from "../typings/tydom.js";
import { debugSet, debugSetResult } from "../utils/debug.js";

type TriggerSwitchSettings = {
  delay?: number;
};

type TriggerSwitchContext = TydomAccessoryContext<TriggerSwitchSettings>;

const TRIGGER_SWITCH_DEFAULT_DELAY = 1000;

export const setupTriggerSwitch = (
  accessory: PlatformAccessory<TriggerSwitchContext>,
  controller: TydomController,
): void => {
  const { context } = accessory;
  const { client } = controller;

  const { deviceId, endpointId, settings } = context;
  const { delay = TRIGGER_SWITCH_DEFAULT_DELAY } = settings;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  // Add the actual accessory Service
  const service = addAccessoryService(accessory, Service.Switch, accessory.displayName, true);

  service
    .getCharacteristic(Characteristic.On)
    .onSet(async (value) => {
      debugSet(Characteristic.On, service, value);
      if (!value) {
        return;
      }
      await client.put(`/devices/${deviceId}/endpoints/${endpointId}/data`, [
        {
          name: "levelCmd",
          value: "TOGGLE",
        },
      ]);
      debugSetResult(Characteristic.On, service, value);
      setTimeout(() => {
        service.updateCharacteristic(Characteristic.On, false);
      }, delay);
    })
    .updateValue(false);
};

export const updateTriggerSwitch = (
  _accessory: PlatformAccessory<TriggerSwitchContext>,
  _controller: TydomController,
  _updates: Record<string, unknown>[],
): void => {
  // no-op
};
