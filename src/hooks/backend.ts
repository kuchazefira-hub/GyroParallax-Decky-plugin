import { ServerAPI } from 'decky-frontend-lib';
import { ParallaxProfile } from '../profiles/presets';

async function rpc<T>(serverAPI: ServerAPI, method: string, args: object = {}): Promise<T | null> {
  try {
    const res = await serverAPI.callPluginMethod<object, T>(method, args);
    if (res.success) return res.result;
    return null;
  } catch {
    return null;
  }
}

export const Backend = {
  getGlobalSettings: (api: ServerAPI) => rpc<ParallaxProfile>(api, 'get_global_settings'),
  saveGlobalSettings: (api: ServerAPI, profile: ParallaxProfile) =>
    rpc(api, 'save_global_settings', { profile }),

  getProfile: (api: ServerAPI, appid: string) => rpc<ParallaxProfile>(api, 'get_profile', { appid }),
  hasProfile: (api: ServerAPI, appid: string) => rpc<boolean>(api, 'has_profile', { appid }),
  saveProfile: (api: ServerAPI, appid: string, profile: ParallaxProfile) =>
    rpc(api, 'save_profile', { appid, profile }),
  deleteProfile: (api: ServerAPI, appid: string) => rpc(api, 'delete_profile', { appid }),

  setCalibration: (api: ServerAPI, appid: string, x: number, y: number) =>
    rpc(api, 'set_calibration', { appid, x, y }),
  resetCalibration: (api: ServerAPI, appid: string) => rpc(api, 'reset_calibration', { appid }),

  getArtwork: (api: ServerAPI, appid: string) =>
    rpc<{ background: string | null; foreground: string | null; logo: string | null }>(
      api, 'get_artwork', { appid }
    ),
  saveCustomImage: (api: ServerAPI, appid: string, layer: string, dataUri: string) =>
    rpc(api, 'save_custom_image', { appid, layer, data_uri: dataUri }),
  getCustomImage: (api: ServerAPI, appid: string, layer: string) =>
    rpc<string | null>(api, 'get_custom_image', { appid, layer }),
  importCustomImage: (api: ServerAPI, appid: string, layer: string, path: string) =>
    rpc<{ ok: boolean; dataUri?: string; error?: string }>(
      api, 'import_custom_image', { appid, layer, path }
    ),

  startGyro: (api: ServerAPI) => rpc<{ available: boolean }>(api, 'start_gyro'),
  stopGyro: (api: ServerAPI) => rpc(api, 'stop_gyro'),
};
