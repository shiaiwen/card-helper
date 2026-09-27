import type { PlatformAdapter } from './platform';

/** 浏览器油猴适配器。目前只使用 grant none 可用的标准浏览器 API。 */
export function createUserscriptPlatform(): PlatformAdapter {
  return {
    platform: 'userscript',
    async openExternal(url) {
      window.open(url, '_blank', 'noopener');
    },
    getSetting: (key) => window.localStorage.getItem(key),
    setSetting: (key, value) => window.localStorage.setItem(key, value)
  };
}
