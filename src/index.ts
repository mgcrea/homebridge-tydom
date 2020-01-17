import debug from 'src/utils/debug';
import TydomPlatform from './platform';
import {PLUGIN_NAME, PLATFORM_NAME} from 'src/config/env';

interface Homebridge {
  version: number;
  serverVersion: string;
  registerPlatform: (pluginName: string, platformName: string, constructor: unknown, dynamic?: boolean) => unknown;
}

export default (homebridge: Homebridge) => {
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TydomPlatform, true);
};
