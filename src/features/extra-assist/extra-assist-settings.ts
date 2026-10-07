/**
 * 游戏辅助设置项：进阶辅助、自动托管、自动换将、百胜、酒馆目标等键与文案。
 */

import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export const EXTRA_ASSIST_ENABLED_KEY = 'assist.extraEnabled' satisfies XiaochaoConfigKey;
export const AUTO_BOT_ENABLED_KEY = 'assist.autoBotEnabled' satisfies XiaochaoConfigKey;
export const AUTO_HG_ENABLED_KEY = 'assist.autoHGEnabled' satisfies XiaochaoConfigKey;
export const BAI_SHENG_ENABLED_KEY = 'assist.baiShengEnabled' satisfies XiaochaoConfigKey;
export const AUTO_BOT_TAVERN_TARGET_KEY = 'assist.autoBotTavernTarget' satisfies XiaochaoConfigKey;

/** 进阶辅助开关的说明文字。 */
export const EXTRA_ASSIST_TOOLTIP = [
  '开启后可使用进阶武将辅助',
  '魔孙权：显示权御增益状态',
  '南华老仙：显示天书选择提示',
  '裴秀：显示地图路线辅助',
  '许劭：显示评鉴可连词框'
].join('\n');

export const AUTO_BOT_TOOLTIP = [
  '自动选将、出牌、桌上准备；大厅可建密码房或国战房',
  '优先跟官方小杀推荐，超时改本地规则，再不行点托管',
  '自己建的托管房才会补人机并开局；进别人的房只准备',
  '可设酒馆时长目标，完成后自动停止',
  '与盖主速刷同时开时，选将和出牌让给盖主',
  '自动化操作存在账号风险，请自行斟酌'
].join('\n');

export const BAI_SHENG_TOOLTIP = [
  '配合小号盖主速刷持续完成百胜战功',
  '每局尽量点将未完成百胜的武将',
  '自动跳过无法在一回合速刷中计入胜场的隐匿武将',
  '自动化操作存在账号风险，请自行斟酌'
].join('\n');

export const AUTO_HG_TOOLTIP = [
  '主公点将黄盖苦肉自杀速刷',
  '可用来刷武将百胜战功和官阶任务',
  '1.小号创建自选身份密码房，选择主公',
  '2.大号加入房间开启自动挂机和百胜战功',
  '3.小号打开盖主速刷（自动点黄盖、苦肉、结算再开）',
  '4.保持两窗口在前台',
  '自动化操作存在账号风险，请自行斟酌'
].join('\n');

export interface GameAssistSwitchSetting {
  key: typeof EXTRA_ASSIST_ENABLED_KEY
    | typeof AUTO_BOT_ENABLED_KEY
    | typeof AUTO_HG_ENABLED_KEY
    | typeof BAI_SHENG_ENABLED_KEY;
  label: string;
  tooltip: string;
  /** 开关可改配置，但功能本体尚未接通时在面板上标明。 */
  pending?: boolean;
}

export const GAME_ASSIST_SWITCH_SETTINGS: readonly GameAssistSwitchSetting[] = [
  {
    key: EXTRA_ASSIST_ENABLED_KEY,
    label: '辅助功能',
    tooltip: EXTRA_ASSIST_TOOLTIP
  }
];
