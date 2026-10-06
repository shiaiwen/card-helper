export type XiaochaoPlatform = 'electron' | 'userscript';

export interface PlatformAdapter {
  readonly platform: XiaochaoPlatform;
  openExternal(url: string): Promise<void>;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  removeSetting(key: string): void;
}
