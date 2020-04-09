import {Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service} from 'hap-nodejs';
import {get, keyBy} from 'lodash';
import locale from 'src/config/locale';
import TydomController from 'src/controller';
import {PlatformAccessory} from 'src/typings/homebridge';
import {
  addAccessoryServiceWithSubtype,
  setupAccessoryIdentifyHandler,
  setupAccessoryInformationService
} from 'src/utils/accessory';
import assert from 'src/utils/assert';
import debug, {debugGet, debugGetResult} from 'src/utils/debug';
import {runTydomDeviceCommand} from 'src/utils/tydom';
import {
  SecuritySystemLabelCommandResult,
  SecuritySystemHistoOpenIssuesCommandResult,
  SecuritySystemProduct
} from 'src/typings/tydom';

const getOpenedIssues = (commandResults: SecuritySystemHistoOpenIssuesCommandResult[]) =>
  keyBy(
    commandResults.filter((result) => result.product).map((result) => result.product!),
    'id'
  );

let contactSensorProducts: SecuritySystemProduct[] = [];
let histoSearchParams: Record<string, string>;

export const setupSecuritySystemSensors = async (
  accessory: PlatformAccessory,
  controller: TydomController
): Promise<void> => {
  const {displayName: name, UUID: id, context} = accessory;
  const {client} = controller;

  const {deviceId, endpointId} = context;
  setupAccessoryInformationService(accessory, controller);
  setupAccessoryIdentifyHandler(accessory, controller);

  const labelResults = await client.command<SecuritySystemLabelCommandResult>(
    `/devices/${deviceId}/endpoints/${endpointId}/cdata?name=label`
  );
  const {products} = labelResults[0];
  contactSensorProducts = products.filter((product) => ['MDO'].includes(product.typeLong));
  histoSearchParams = {type: 'OPEN_ISSUES', indexStart: '0', nbElem: `${contactSensorProducts.length}`};

  const initialOpenedIssues = getOpenedIssues(
    await runTydomDeviceCommand<SecuritySystemHistoOpenIssuesCommandResult>(client, 'histo', {
      deviceId,
      endpointId,
      searchParams: histoSearchParams
    })
  );

  contactSensorProducts.forEach((contactSensorProduct) => {
    const {id: productId, nameStd, nameCustom, number} = contactSensorProduct;
    const subDeviceId = `systOpenIssue_${productId}`;
    const subDeviceName = nameCustom || `${get(locale, nameStd, 'N/A') as string}${number ? ` ${number}` : ''}`;
    const contactSensorService = addAccessoryServiceWithSubtype(
      accessory,
      Service.ContactSensor,
      subDeviceName,
      subDeviceId,
      true
    );
    debug(`Adding new "Service.ContactSensor" with name="${subDeviceName}", id="${subDeviceId}"`);
    // contactSensorService.linkedServices = [service];
    contactSensorService
      .getCharacteristic(Characteristic.ContactSensorState)!
      .setValue(initialOpenedIssues[productId] ? 1 : 0)
      .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
        debugGet(subDeviceId, {name, id});
        try {
          const openedIssues = getOpenedIssues(
            await runTydomDeviceCommand<SecuritySystemHistoOpenIssuesCommandResult>(client, 'histo', {
              deviceId,
              endpointId,
              searchParams: histoSearchParams
            })
          );
          const nextValue = openedIssues[productId] ? 1 : 0;
          debugGetResult(subDeviceId, {name, id, value: nextValue});
          callback(null, nextValue);
        } catch (err) {
          callback(err);
        }
      });
    contactSensorService.getCharacteristic(Characteristic.StatusActive)!.setValue(1);
    contactSensorService.getCharacteristic(Characteristic.StatusFault)!.setValue(0);
  });
};

export const updateSecuritySystemSensors = (
  accessory: PlatformAccessory,
  controller: TydomController,
  updates: Record<string, unknown>[]
) => {
  const {client} = controller;
  updates.forEach(async (update) => {
    const {context} = accessory;
    const {deviceId, endpointId} = context;
    const {name} = update;
    switch (name) {
      case 'systOpenIssue': {
        const systOpenIssue = update!.value as boolean;
        if (!systOpenIssue) {
          contactSensorProducts.forEach(({id: productId}) => {
            const subDeviceId = `systOpenIssue_${productId}`;
            const service = accessory.getServiceByUUIDAndSubType(Service.ContactSensor, subDeviceId);
            assert(
              service,
              `Unexpected missing service "Service.ContactSensor" with subtype="${subDeviceId}" in accessory`
            );
            service.getCharacteristic(Characteristic.ContactSensorState)!.updateValue(0);
          });
        } else {
          const openedIssues = getOpenedIssues(
            await runTydomDeviceCommand<SecuritySystemHistoOpenIssuesCommandResult>(client, 'histo', {
              deviceId,
              endpointId,
              searchParams: histoSearchParams
            })
          );
          contactSensorProducts.forEach(({id: productId}) => {
            const subDeviceId = `systOpenIssue_${productId}`;
            const service = accessory.getServiceByUUIDAndSubType(Service.ContactSensor, subDeviceId);
            assert(
              service,
              `Unexpected missing service "Service.ContactSensor" with subtype="${subDeviceId}" in accessory`
            );
            service.getCharacteristic(Characteristic.ContactSensorState)!.updateValue(openedIssues[productId] ? 1 : 0);
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
