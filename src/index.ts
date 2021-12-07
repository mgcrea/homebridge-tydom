import type {API as Homebridge} from 'homebridge';
import 'source-map-support/register';
import {PLATFORM_NAME, PLUGIN_NAME} from './config/env';
import TydomPlatform from './platform';
import {defineHAPGlobals} from './config/hap';

export default (homebridge: Homebridge): void => {
  defineHAPGlobals(homebridge);
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TydomPlatform);
};
