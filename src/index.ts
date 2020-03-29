import 'source-map-support/register';
import {PLATFORM_NAME, PLUGIN_NAME} from 'src/config/env';
import TydomPlatform from './platform';

interface Homebridge {
  version: number;
  serverVersion: string;
  registerPlatform: (pluginName: string, platformName: string, constructor: unknown, dynamic?: boolean) => unknown;
}

export default (homebridge: Homebridge) => {
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TydomPlatform, true);
};
