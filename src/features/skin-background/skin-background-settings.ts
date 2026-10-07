/**
 * 皮肤背景设置项声明与文案。
 */

import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export type SkinBackgroundSettingKey = XiaochaoConfigKey & `skin.${string}`;

export interface SkinBackgroundSetting {
  key: SkinBackgroundSettingKey;
  label: string;
  tooltip: string;
  /** 只有该开关开启时才显示本项。 */
  visibleWhen?: SkinBackgroundSettingKey;
}

export const SKIN_SETTINGS: readonly SkinBackgroundSetting[] = [
  {
    key: 'skin.localSkin',
    label: '皮肤解锁',
    tooltip: '已拥有的皮肤正常换肤\n未拥有的皮肤本地解锁，他人不可见'
  },
  {
    key: 'skin.otherLocalSkin',
    label: '他人换肤',
    tooltip: '给其他角色本地换肤\n仅本局生效，仅自己可见\n旁观模式下不生效'
  }
];

export const BACKGROUND_SETTINGS: readonly SkinBackgroundSetting[] = [
  {
    key: 'skin.officialBackground',
    label: '官方背景',
    tooltip: '解锁官方背景功能的所有背景'
  },
  {
    key: 'skin.skinPaper',
    label: '皮肤做背景',
    tooltip: '进入皮肤详情界面进行设置\n收藏后可在局内右上角背景按钮快速切换\n如果要使用动态皮肤做背景\n请先将皮肤切换为动态形态再设置'
  },
  {
    key: 'skin.allPaper',
    label: '全局背景',
    tooltip: '全局背景也替换为皮肤做背景',
    visibleWhen: 'skin.skinPaper'
  }
];

export const ALL_SKIN_BACKGROUND_SETTINGS: readonly SkinBackgroundSetting[] = [
  ...SKIN_SETTINGS,
  ...BACKGROUND_SETTINGS
];
