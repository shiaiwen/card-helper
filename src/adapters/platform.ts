/**
 * 平台适配器契约：隔离 Electron 微端与油猴在外链、本地设置上的差异。
 * 业务模块只依赖本接口，不直接碰 window.electron / GM_*。
 */
export type XiaochaoPlatform = 'electron' | 'userscript';

export interface PlatformAdapter {
  readonly platform: XiaochaoPlatform;
  openExternal(url: string): Promise<void>;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  removeSetting(key: string): void;
}
