import 'source-map-support/register';
import {PLATFORM_NAME, PLUGIN_NAME} from 'src/config/env';
import TydomPlatform from './platform';
import {defineHAPGlobals} from 'src/utils/hap';
import type {API as Homebridge} from 'homebridge';

export default (homebridge: Homebridge): void => {
  defineHAPGlobals(homebridge);
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TydomPlatform);
};
