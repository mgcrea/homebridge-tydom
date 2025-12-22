import type { PlatformAccessory } from "homebridge";
import { get, keyBy } from "lodash";
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicValue,
  NodeCallback,
  Service,
} from "../config/hap";
import locale from "../config/locale";
import TydomController from "../controller";
import {
  addAccessoryServiceWithSubtype,
  getAccessoryServiceWithSubtype,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService,
  TydomAccessoryUpdateType,
} from "../helpers/accessory";
import { runTydomDeviceCommand } from "../helpers/tydom";
import type {
  SecuritySystemHistoOpenIssuesCommandResult,
  SecuritySystemLabelCommandResult,
  SecuritySystemProduct,
  TydomAccessoryContext,
} from "../typings/tydom";
import { debugAddSubService, debugGet, debugGetResult, debugSetUpdate } from "../utils/debug";

const getOpenedIssues = (commandResults: SecuritySystemHistoOpenIssuesCommandResult[]) =>
  keyBy(
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    commandResults.filter((result) => result.product).map((result) => result.product!),
    "id",
  );

let contactSensorProducts: SecuritySystemProduct[] = [];
let histoSearchParams: Record<string, string>;

export const setupSecuritySystemSensors = async (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
): Promise<void> => {
  const { context } = accessory;
  const { client } = controller;
  const { ContactSensorState } = Characteristic;

  const { deviceId, endpointId } = context as TydomAccessoryContext;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  const labelResults = await client.command<SecuritySystemLabelCommandResult>(
    `/devices/${deviceId}/endpoints/${endpointId}/cdata?name=label`,
  );
  const { products } = labelResults[0];
  contactSensorProducts = products.filter((product) => ["MDO"].includes(product.typeLong));
  histoSearchParams = { type: "OPEN_ISSUES", indexStart: "0", nbElem: `${contactSensorProducts.length}` };

  const initialOpenedIssues = getOpenedIssues(
    await runTydomDeviceCommand<SecuritySystemHistoOpenIssuesCommandResult>(client, "histo", {
      deviceId,
      endpointId,
      searchParams: histoSearchParams,
    }),
  );

  contactSensorProducts.forEach((contactSensorProduct) => {
    const { id: productId, nameStd, nameCustom, number } = contactSensorProduct;
    const subDeviceId = `systOpenIssue_${productId}`;
    const subDeviceName =
      nameCustom || `${get(locale, nameStd, "N/A") as string}${number ? ` ${number}` : ""}`;
    const contactSensorService = addAccessoryServiceWithSubtype(
      accessory,
      Service.ContactSensor,
      subDeviceName,
      subDeviceId,
      true,
    );
    debugAddSubService(contactSensorService, accessory);
    // service.addLinkedService(contactSensorService); // @TODO ServiceLabel?
    contactSensorService
      .getCharacteristic(ContactSensorState)
      .setValue(initialOpenedIssues[productId] ? 1 : 0)
      .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
        debugGet(ContactSensorState, contactSensorService);
        try {
          const openedIssues = getOpenedIssues(
            await runTydomDeviceCommand<SecuritySystemHistoOpenIssuesCommandResult>(client, "histo", {
              deviceId,
              endpointId,
              searchParams: histoSearchParams,
            }),
          );
          const nextValue = openedIssues[productId] ? 1 : 0;
          debugGetResult(ContactSensorState, contactSensorService, nextValue);
          callback(null, nextValue);
        } catch (err) {
          callback(err as Error);
        }
      });
    contactSensorService.getCharacteristic(Characteristic.StatusActive).setValue(1);
    contactSensorService.getCharacteristic(Characteristic.StatusFault).setValue(0);
  });
};

export const updateSecuritySystemSensors = (
  accessory: PlatformAccessory<TydomAccessoryContext>,
  controller: TydomController,
  updates: Record<string, unknown>[],
  type: TydomAccessoryUpdateType,
): void => {
  const { client } = controller;
  // Process command updates
  if (type === "cdata") {
    return;
  }

  updates.forEach(async (update) => {
    const { context } = accessory;
    const { deviceId, endpointId } = context;
    const { ContactSensorState } = Characteristic;
    const { name, value } = update;
    switch (name) {
      case "systOpenIssue": {
        const systOpenIssue = value as boolean;
        if (!systOpenIssue) {
          contactSensorProducts.forEach(({ id: productId }) => {
            const subDeviceId = `systOpenIssue_${productId}`;
            const service = getAccessoryServiceWithSubtype(accessory, Service.ContactSensor, subDeviceId);
            const nextValue = 0;
            debugSetUpdate(ContactSensorState, service, nextValue);
            service.updateCharacteristic(ContactSensorState, nextValue);
          });
        } else {
          const openedIssues = getOpenedIssues(
            await runTydomDeviceCommand<SecuritySystemHistoOpenIssuesCommandResult>(client, "histo", {
              deviceId,
              endpointId,
              searchParams: histoSearchParams,
            }),
          );
          contactSensorProducts.forEach(({ id: productId }) => {
            const subDeviceId = `systOpenIssue_${productId}`;
            const service = getAccessoryServiceWithSubtype(accessory, Service.ContactSensor, subDeviceId);
            const nextValue = openedIssues[productId] ? 1 : 0;
            debugSetUpdate(ContactSensorState, service, nextValue);
            service.updateCharacteristic(ContactSensorState, nextValue);
          });
        }
        return;
      }
      default:
        return;
    }
  });
};

/*
{
  initialOpenedIssues: [
    {
      step: 0,
      nbElemTot: 2,
      index: 16,
      product: {
        typeShort: 'MDO',
        typeLong: 'MDO',
        id: 16,
        nameStd: 'BASEMENT',
        number: 3
      }
    },
    {
      step: 1,
      nbElemTot: 2,
      index: 17,
      product: {
        typeShort: 'MDO',
        typeLong: 'MDO',
        id: 17,
        nameStd: 'BASEMENT',
        number: 2
      }
    },
    { step: 2, nbElemTot: 2, index: 51 }
  ]
}
*/
/*
{
  openedIssues: {
    '16': {
      typeShort: 'MDO',
      typeLong: 'MDO',
      id: 16,
      nameStd: 'BASEMENT',
      number: 3
    },
    '17': {
      typeShort: 'MDO',
      typeLong: 'MDO',
      id: 17,
      nameStd: 'BASEMENT',
      number: 2
    }
  }
}
*/
