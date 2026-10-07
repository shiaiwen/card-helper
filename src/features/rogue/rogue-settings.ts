/**
 * 山河图设置键与文案：地图透视、隐藏剧情、商店预览等。
 */

import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export type RogueSwitchKey = XiaochaoConfigKey & `rogue.${string}`;

export interface RogueSwitchSetting {
  key: RogueSwitchKey;
  label: string;
  tooltip: string;
}

/** 山河地图开关，默认开。 */
export const ROGUE_MAP_KEY = 'rogue.mapEnabled' satisfies RogueSwitchKey;

/** 隐藏对白开关，默认关。 */
export const ROGUE_HIDE_STORY_KEY = 'rogue.hideStory' satisfies RogueSwitchKey;

export const ROGUE_MAP_SETTING: RogueSwitchSetting = {
  key: ROGUE_MAP_KEY,
  label: '山河地图',
  tooltip: '小地图上预览城池事件'
};

export const ROGUE_HIDE_STORY_SETTING: RogueSwitchSetting = {
  key: ROGUE_HIDE_STORY_KEY,
  label: '隐藏对白',
  tooltip: '山河图场景对白不显示'
};

export const ROGUE_SWITCH_SETTINGS: readonly RogueSwitchSetting[] = [
  ROGUE_MAP_SETTING,
  ROGUE_HIDE_STORY_SETTING
];

/** 打开山河图集市窗口。 */
export const ROGUE_OPEN_SHOP_LABEL = '打开集市';
export const ROGUE_OPEN_SHOP_TOOLTIP = '打开山河图集市窗口（RogueJiShiWindow）';

/** 「集市预览」区域标题。 */
export const ROGUE_SHOP_PREVIEW_LABEL = '集市透视';
export const ROGUE_SHOP_PREVIEW_TOOLTIP = '根据同步包 shopData.itemId + Rplot 预览集市商品与价格；暂无数据时不显示';
