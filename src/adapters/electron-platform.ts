import type { PlatformAdapter } from './platform';

/** Electron 微端适配器。业务层不直接依赖 preload 暴露的 window.electron。 */
export function createElectronPlatform(): PlatformAdapter {
  return {
    platform: 'electron',
    async openExternal(url) {
      if (typeof window.electron?.openExternal === 'function') {
        await window.electron.openExternal(url);
        return;
      }
      window.open(url, '_blank', 'noopener');
    },
    getSetting: (key) => window.localStorage.getItem(key),
    setSetting: (key, value) => window.localStorage.setItem(key, value)
  };
}
